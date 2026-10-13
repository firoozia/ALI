package com.zinax.stock.data

import androidx.room.withTransaction
import com.zinax.stock.core.Category
import com.zinax.stock.core.CustomerNames
import com.zinax.stock.core.CutPlan
import com.zinax.stock.core.Format
import com.zinax.stock.core.LabelId
import com.zinax.stock.core.Pin
import com.zinax.stock.core.Units
import com.zinax.stock.importer.ParsedUnit
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID

class Repository(
    private val db: AppDatabase,
    private val prefs: Prefs,
    /** Called after every local change so a sync can be scheduled. */
    private val onChange: () -> Unit,
) {
    val dao = db.dao()
    private val idLock = Mutex()

    private fun now() = System.currentTimeMillis()
    private fun uuid() = UUID.randomUUID().toString()

    suspend fun importShipment(name: String, source: String, units: List<ParsedUnit>): String {
        val t = now()
        val shipment = Shipment(uuid(), name.trim(), source, t, t)
        val rows = units.map {
            ExpectedUnit(
                id = uuid(), shipmentId = shipment.id, pallet = it.pallet, lineNo = it.lineNo,
                category = it.category.name, code = it.code, size = it.size, qty = it.qty, unit = Units.normalize(it.unit),
                netKg = it.netKg, grossKg = it.grossKg, itemId = null, updatedAt = t,
            )
        }
        db.withTransaction {
            dao.putShipments(listOf(shipment))
            dao.putExpected(rows)
        }
        onChange()
        return shipment.id
    }

    /** Next free label IDs for today on this device. */
    private suspend fun nextIds(count: Int): List<String> {
        val date = LabelId.datePart(now())
        val device = prefs.deviceCode
        val prefix = LabelId.prefix(date, device)
        val last = dao.lastIdWithPrefix(prefix)?.let { LabelId.sequence(it) } ?: 0
        return (1..count).map { LabelId.make(date, device, last + it) }
    }

    /** Creates items for expected units that have no label yet. Returns the new items in list order. */
    suspend fun labelExpected(unitIds: List<String>, location: String = ""): List<Item> = idLock.withLock {
        db.withTransaction {
            val units = dao.expectedByIds(unitIds).filter { it.itemId == null }
                .sortedBy { unitIds.indexOf(it.id) }
            if (units.isEmpty()) return@withTransaction emptyList()
            val t = now()
            val ids = nextIds(units.size)
            val items = units.mapIndexed { i, u ->
                Item(
                    id = ids[i], category = u.category, code = u.code, size = u.size, unit = u.unit,
                    qty = u.qty, remaining = u.qty, status = ItemStatus.IN_STOCK,
                    shipmentId = u.shipmentId, pallet = u.pallet, netKg = u.netKg, grossKg = u.grossKg,
                    receivedAt = t, location = location.trim(), device = prefs.deviceCode, updatedAt = t,
                )
            }
            dao.putItems(items)
            dao.putExpected(units.mapIndexed { i, u -> u.copy(itemId = ids[i], updatedAt = t, dirty = true) })
            dao.putMovements(items.map { inMovement(it, t) })
            items
        }
    }.also { onChange() }

    suspend fun createManual(
        category: Category, code: String, size: String, qty: Double, unit: String,
        count: Int, shipmentId: String?, pallet: String?, location: String = "",
        /** For a roll already cut before it was labelled: what is left on it. [qty] is then its original length. */
        remaining: Double? = null,
    ): List<Item> = idLock.withLock {
        db.withTransaction {
            val t = now()
            val items = nextIds(count).map { id ->
                Item(
                    id = id, category = category.name, code = code.trim(), size = size.trim(), unit = Units.normalize(unit),
                    qty = qty, remaining = remaining?.coerceAtMost(qty) ?: qty, status = ItemStatus.IN_STOCK,
                    shipmentId = shipmentId, pallet = pallet, netKg = null, grossKg = null,
                    receivedAt = t, location = location.trim(), device = prefs.deviceCode, updatedAt = t,
                )
            }
            dao.putItems(items)
            dao.putMovements(items.map { inMovement(it, t) })
            items
        }
    }.also { onChange() }

    private fun inMovement(item: Item, t: Long) = Movement(
        id = uuid(), itemId = item.id, type = MovementType.IN, qty = item.remaining, reference = item.pallet?.let { "Pallet $it" } ?: "Manual",
        at = t, device = prefs.deviceCode, code = item.code, size = item.size, unit = item.unit, user = prefs.userName,
    )

    /** Ships [qty] out of [itemId]. A package is marked shipped when nothing is left. */
    suspend fun shipOut(itemId: String, qty: Double, customer: String, invoice: String = ""): Item {
        val who = CustomerNames.clean(customer)
        require(who.isNotEmpty()) { "Enter the customer" }
        val reference = listOf(who, invoice.trim()).filter { it.isNotEmpty() }.joinToString(" · ")
        val result = db.withTransaction {
            val item = dao.item(itemId) ?: error("Unknown label $itemId")
            check(item.status == ItemStatus.IN_STOCK) { "$itemId was already shipped" }
            require(qty > 0) { "Enter a quantity above zero" }
            require(qty <= item.remaining + 1e-6) { "Only ${item.remaining} ${item.unit} left on $itemId" }
            val t = now()
            val left = (item.remaining - qty).let { if (it < 1e-6) 0.0 else it }
            val updated = item.copy(
                remaining = left,
                status = if (left == 0.0) ItemStatus.SHIPPED else ItemStatus.IN_STOCK,
                updatedAt = t, dirty = true,
            )
            dao.putItems(listOf(updated))
            dao.putMovements(
                listOf(
                    Movement(
                        id = uuid(), itemId = item.id, type = MovementType.OUT, qty = qty, reference = reference,
                        at = t, device = prefs.deviceCode, code = item.code, size = item.size, unit = item.unit, user = prefs.userName,
                        customer = who, invoice = invoice.trim(),
                    )
                )
            )
            if (who.isNotEmpty()) addCustomerIn(who, t)
            updated
        }
        onChange()
        return result
    }

    /** What to do with a short end left by a cut. */
    enum class EndChoice { KEEP, WASTE, GIVE_ALL }

    /** The result of a cut, with what the customer label needs. */
    data class CutResult(val roll: Item, val length: Double, val customer: String, val invoice: String, val cutNo: Int, val at: Long, val wasted: Double)

    /**
     * Cuts [length] metres (or the package's unit) from [itemId] for [customer].
     * [end] decides what happens to a short end; GIVE_ALL gives the customer the whole remainder.
     */
    suspend fun cut(itemId: String, length: Double, customer: String, invoice: String, end: EndChoice = EndChoice.KEEP): CutResult {
        val who = CustomerNames.clean(customer)
        val result = db.withTransaction {
            val item = dao.item(itemId) ?: error("Unknown label $itemId")
            check(item.status == ItemStatus.IN_STOCK) { "$itemId is not in stock" }
            require(length > 0) { "Enter a length above zero" }
            require(length <= item.remaining + 1e-6) { "Only ${Format.qtyUnit(item.remaining, item.unit)} left on $itemId" }
            val t = now()
            val taken = if (end == EndChoice.GIVE_ALL) item.remaining else length
            var left = CutPlan.left(item.remaining, taken)
            val moves = ArrayList<Movement>()
            moves.add(
                Movement(
                    id = uuid(), itemId = item.id, type = MovementType.CUT, qty = taken,
                    reference = listOf(who, invoice.trim()).filter { it.isNotEmpty() }.joinToString(" · "),
                    at = t, device = prefs.deviceCode, code = item.code, size = item.size, unit = item.unit, user = prefs.userName,
                    customer = who, invoice = invoice.trim(),
                )
            )
            var wasted = 0.0
            if (end == EndChoice.WASTE && left > 0) {
                wasted = left
                moves.add(
                    Movement(
                        id = uuid(), itemId = item.id, type = MovementType.WASTE, qty = left, reference = "Short end",
                        at = t + 1, device = prefs.deviceCode, code = item.code, size = item.size, unit = item.unit, user = prefs.userName,
                    )
                )
                left = 0.0
            }
            val updated = item.copy(
                remaining = left,
                status = if (left == 0.0) ItemStatus.SHIPPED else ItemStatus.IN_STOCK,
                updatedAt = t, dirty = true,
            )
            dao.putItems(listOf(updated))
            dao.putMovements(moves)
            if (who.isNotEmpty()) addCustomerIn(who, t)
            CutResult(updated, taken, who, invoice.trim(), dao.cutCount(item.id), t, wasted)
        }
        onChange()
        return result
    }

    // ---------- customers ----------

    /** Adds [name] to the library unless it is there already; a hidden match is shown again. */
    private suspend fun addCustomerIn(name: String, t: Long) {
        val key = CustomerNames.key(name)
        val match = dao.allCustomers().firstOrNull { CustomerNames.key(it.name) == key }
        when {
            match == null -> dao.putCustomers(listOf(Customer(uuid(), name, t, prefs.userName, t)))
            match.hidden -> dao.putCustomers(listOf(match.copy(hidden = false, updatedAt = t, dirty = true)))
        }
    }

    suspend fun addCustomer(name: String) {
        val clean = CustomerNames.clean(name)
        if (clean.isEmpty()) return
        db.withTransaction { addCustomerIn(clean, now()) }
        onChange()
    }

    suspend fun renameCustomer(id: String, name: String) {
        val clean = CustomerNames.clean(name)
        val c = dao.customer(id) ?: return
        if (clean.isEmpty() || clean == c.name) return
        dao.putCustomers(listOf(c.copy(name = clean, updatedAt = now(), dirty = true)))
        onChange()
    }

    suspend fun hideCustomer(id: String) {
        val c = dao.customer(id) ?: return
        dao.putCustomers(listOf(c.copy(hidden = true, updatedAt = now(), dirty = true)))
        onChange()
    }

    /**
     * Cancels a ship-out made by mistake: the amount goes back on the package and the package is in stock again.
     * The ship-out stays in the log with an UNDO row naming who cancelled it.
     */
    suspend fun undoShipOut(movementId: String, by: String = prefs.userName) {
        db.withTransaction {
            val m = dao.movement(movementId) ?: error("Ship-out not found")
            check(m.type in setOf(MovementType.OUT, MovementType.CUT, MovementType.WASTE)) { "Only ship-outs, cuts and waste can be undone" }
            check(movementId !in dao.undoneIdsNow()) { "This was already undone" }
            val item = dao.item(m.itemId) ?: error("Label ${m.itemId} not found")
            check(item.status != ItemStatus.VOID) { "${item.id} was deleted" }
            val t = now()
            val back = minOf(item.qty, item.remaining + m.qty)
            dao.putItems(listOf(item.copy(remaining = back, status = ItemStatus.IN_STOCK, updatedAt = t, dirty = true)))
            dao.putMovements(
                listOf(
                    Movement(
                        id = uuid(), itemId = item.id, type = MovementType.UNDO, qty = m.qty, reference = m.id,
                        at = t, device = prefs.deviceCode, code = item.code, size = item.size, unit = item.unit, user = by,
                    )
                )
            )
        }
        onChange()
    }

    /** Oldest in-stock package of the same code and size received on an earlier day. */
    suspend fun olderThan(item: Item): Item? {
        val cal = java.util.Calendar.getInstance().apply {
            timeInMillis = item.receivedAt
            set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0)
            set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
        }
        return dao.olderInStock(item.code, item.size, cal.timeInMillis, item.id)
    }

    /**
     * Deletes labels entered by mistake. They leave stock, reports and the sheet's Stock tab, and stay
     * in the Items tab marked VOID. A label printed from a packing list goes back to "to print".
     */
    suspend fun voidItems(itemIds: List<String>, by: String = prefs.userName) {
        db.withTransaction {
            val t = now()
            val items = itemIds.chunked(500).flatMap { dao.itemsByIds(it) }.filter { it.status == ItemStatus.IN_STOCK }
            if (items.isEmpty()) return@withTransaction
            dao.putItems(items.map { it.copy(status = ItemStatus.VOID, remaining = 0.0, updatedAt = t, dirty = true) })
            dao.putMovements(
                items.map {
                    Movement(
                        id = uuid(), itemId = it.id, type = MovementType.VOID, qty = it.remaining, reference = "Deleted",
                        at = t, device = prefs.deviceCode, code = it.code, size = it.size, unit = it.unit, user = by,
                    )
                }
            )
            val units = items.map { it.id }.chunked(500).flatMap { dao.expectedByItemIds(it) }
            if (units.isNotEmpty()) dao.putExpected(units.map { it.copy(itemId = null, updatedAt = t, dirty = true) })
        }
        onChange()
    }

    suspend fun setLocation(itemId: String, location: String) = setLocations(listOf(itemId), location)

    /** Moves packages to [location]; only packages that change place are touched. Each move is logged. */
    suspend fun setLocations(itemIds: List<String>, location: String) {
        val t = now()
        val target = location.trim()
        val before = itemIds.chunked(500).flatMap { dao.itemsByIds(it) }.filter { it.location != target }
        if (before.isEmpty()) return
        db.withTransaction {
            dao.putItems(before.map { it.copy(location = target, updatedAt = t, dirty = true) })
            dao.putMovements(
                before.map {
                    Movement(
                        id = uuid(), itemId = it.id, type = MovementType.MOVE, qty = it.remaining,
                        reference = "${it.location.ifBlank { "No location" }} → ${target.ifBlank { "No location" }}",
                        at = t, device = prefs.deviceCode, code = it.code, size = it.size, unit = it.unit, user = prefs.userName,
                    )
                }
            )
        }
        onChange()
    }

    /**
     * Corrects category, code, size or unit of in-stock labels. Each label that changes gets an EDIT
     * movement saying what changed and who did it. Returns the labels after the change.
     */
    suspend fun editItems(itemIds: List<String>, rawEdit: ItemEdit, by: String = prefs.userName): List<Item> {
        val edit = rawEdit.copy(unit = rawEdit.unit?.let { Units.normalize(it) })
        val result = db.withTransaction {
            val t = now()
            val items = itemIds.chunked(500).flatMap { dao.itemsByIds(it) }.filter { it.status == ItemStatus.IN_STOCK }
            val changed = items.mapNotNull { item -> edit.against(item)?.let { item to it } }
            if (changed.isEmpty()) return@withTransaction emptyList()
            val updated = changed.map { (item, e) -> e.applyTo(item).copy(updatedAt = t, dirty = true) }
            dao.putItems(updated)
            dao.putMovements(
                changed.zip(updated).map { (pair, after) ->
                    Movement(
                        id = uuid(), itemId = after.id, type = MovementType.EDIT, qty = after.remaining,
                        reference = pair.second.describe(pair.first), at = t, device = prefs.deviceCode,
                        code = after.code, size = after.size, unit = after.unit, user = by,
                    )
                }
            )
            updated
        }
        onChange()
        return result
    }

    // ---------- groups and products ----------

    /** Same ID on every phone for the same product, so phones that fill the catalog at once do not make duplicates. */
    private fun productId(groupId: String, code: String, size: String, unit: String): String =
        "P_" + UUID.nameUUIDFromBytes("$groupId|$code|$size|$unit".lowercase().toByteArray()).toString().replace("-", "").take(20)

    /** Adds the built-in groups, and once per phone a product for every code, size and unit already labelled. */
    suspend fun seedCatalog() {
        if (dao.allGroups().isEmpty()) {
            dao.putGroups(Category.builtIns.map { GroupRow(it.name, it.label, it.unit, it.pack, it.ordinal, false, 1L) })
        }
        if (!prefs.catalogSeeded) {
            val known = dao.allProducts().map { it.id }.toSet()
            val labelled = dao.itemProducts()
            // A new phone has no labels until its first sync; fill the catalog then.
            if (labelled.isEmpty()) return
            val rows = labelled
                .filter { it.code.isNotBlank() }
                .groupBy { listOf(it.category, it.code.trim(), it.size.trim(), it.unit.trim()) }
                .map { (k, list) ->
                    val qty = list.groupingBy { it.qty }.eachCount().maxByOrNull { it.value }?.key ?: 0.0
                    Product(productId(k[0], k[1], k[2], k[3]), k[0], k[1], k[2], k[3], qty, "", false, 1L)
                }
                .filter { it.id !in known }
            if (rows.isNotEmpty()) dao.putProducts(rows)
            prefs.catalogSeeded = true
            if (rows.isNotEmpty()) onChange()
        }
    }

    private fun sameProduct(a: Product, b: Product) =
        a.code.trim().equals(b.code.trim(), ignoreCase = true) && a.size.trim().equals(b.size.trim(), ignoreCase = true) &&
            a.groupId == b.groupId

    /**
     * Saves a new or changed product. When group, code, size or unit changed and [applyToStock] is set, the
     * labels in stock that had the old values are corrected too; those labels are returned for reprinting.
     */
    suspend fun saveProduct(p: Product, applyToStock: Boolean): SaveResult {
        val clean = p.copy(code = p.code.trim(), size = p.size.trim(), unit = Units.normalize(p.unit), note = p.note.trim())
        require(clean.code.isNotEmpty()) { "Enter a code" }
        require(clean.unit.isNotEmpty()) { "Enter a unit" }
        val all = dao.allProducts()
        val old = all.firstOrNull { it.id == clean.id }
        val twin = all.firstOrNull { it.id != clean.id && !it.hidden && sameProduct(it, clean) }
        val t = now()
        if (twin != null) {
            require(old != null) { "${clean.code} ${Format.size(clean.size)} is already in ${Category.fromName(clean.groupId).label}" }
            // Moving onto a product that is already there: keep that one, drop this one, and move the labels.
            val keep = if (twin.note.isBlank() && clean.note.isNotBlank()) twin.copy(note = clean.note, updatedAt = t, dirty = true) else twin
            dao.putProducts(listOfNotNull(keep.takeIf { it !== twin }, old.copy(hidden = true, updatedAt = t, dirty = true)))
            var moved = emptyList<Item>()
            if (applyToStock) {
                val edit = ItemEdit(
                    twin.groupId.takeIf { it != old.groupId }, twin.code.takeIf { it != old.code },
                    twin.size.takeIf { it != old.size }, clean.unit.takeIf { it != old.unit },
                )
                val ids = stockOf(old).map { it.id }
                if (ids.isNotEmpty()) moved = editItems(ids, edit)
            }
            onChange()
            return SaveResult(moved, merged = true)
        }
        val id = clean.id.ifBlank { productId(clean.groupId, clean.code, clean.size, clean.unit) + uuid().take(4) }
        dao.putProducts(listOf(clean.copy(id = id, updatedAt = t, dirty = true)))
        var corrected = emptyList<Item>()
        // Only the unit spelling tidied ("M" → "m"): the labels follow even without the checkbox.
        val tidyOnly = old != null && old.unit != clean.unit && Units.normalize(old.unit) == clean.unit
        if (old != null && (applyToStock || tidyOnly)) {
            val edit = if (applyToStock) ItemEdit(
                clean.groupId.takeIf { it != old.groupId }, clean.code.takeIf { it != old.code },
                clean.size.takeIf { it != old.size }, clean.unit.takeIf { it != old.unit },
            ) else ItemEdit(unit = clean.unit)
            val ids = stockOf(old).map { it.id }
            if (ids.isNotEmpty() && (edit.category != null || edit.code != null || edit.size != null || edit.unit != null)) {
                corrected = editItems(ids, edit)
            }
        }
        onChange()
        return SaveResult(corrected, merged = false)
    }

    /** Labels corrected by a product save, and whether the product was merged into one already there. */
    data class SaveResult(val corrected: List<Item>, val merged: Boolean)

    /** One kind of unit spelling to tidy, e.g. "M" → "m", with how many labels, products and pallet lines use it. */
    data class UnitFix(val from: String, val to: String, val labels: Int, val products: Int, val lines: Int)

    /** Unit spellings in stock, in the catalog and on pallets still to receive that differ from the usual one. */
    suspend fun unitFixes(): List<UnitFix> {
        val items = dao.inStock().first()
        val products = dao.allProducts().filter { !it.hidden }
        val lines = dao.allExpected().first().filter { it.itemId == null }
        val spellings = (items.map { it.unit } + products.map { it.unit } + lines.map { it.unit }).distinct()
        return spellings.filter { Units.normalize(it) != it }.map { u ->
            UnitFix(u, Units.normalize(u), items.count { it.unit == u }, products.count { it.unit == u }, lines.count { it.unit == u })
        }.sortedByDescending { it.labels + it.products + it.lines }
    }

    /**
     * Rewrites every unit spelling from [unitFixes] to the usual one: labels in stock (logged as edits, no new
     * labels needed), catalog products (merging ones that become the same) and pallet lines still to receive.
     */
    suspend fun tidyUnits(): Int {
        val fixes = unitFixes()
        if (fixes.isEmpty()) return 0
        var changed = 0
        val items = dao.inStock().first()
        for (f in fixes) {
            val ids = items.filter { it.unit == f.from }.map { it.id }
            if (ids.isNotEmpty()) changed += editItems(ids, ItemEdit(unit = f.to)).size
        }
        val t = now()
        val untidyLines = dao.allExpected().first().filter { it.itemId == null && Units.normalize(it.unit) != it.unit }
        db.withTransaction {
            val products = dao.allProducts()
            val keep = HashMap<String, Product>()
            val out = ArrayList<Product>()
            // Visible products first, so a merge keeps the one people see.
            products.sortedBy { it.hidden }.forEach { p ->
                val unit = Units.normalize(p.unit)
                val key = listOf(p.groupId, p.code.trim().lowercase(), p.size.trim().lowercase(), unit).joinToString("|")
                val first = keep[key]
                when {
                    p.hidden -> if (unit != p.unit) out += p.copy(unit = unit, updatedAt = t, dirty = true)
                    first == null -> {
                        keep[key] = p
                        if (unit != p.unit) out += p.copy(unit = unit, updatedAt = t, dirty = true)
                    }
                    else -> {
                        // Same product twice once the unit is tidied: keep the first, carry over a note, drop this one.
                        if (first.note.isBlank() && p.note.isNotBlank()) {
                            val merged = first.copy(unit = unit, note = p.note, updatedAt = t, dirty = true)
                            keep[key] = merged
                            out.removeAll { it.id == first.id }
                            out += merged
                        }
                        out += p.copy(unit = unit, hidden = true, updatedAt = t, dirty = true)
                    }
                }
            }
            if (out.isNotEmpty()) dao.putProducts(out)
            changed += out.size
            if (untidyLines.isNotEmpty()) dao.putExpected(untidyLines.map { it.copy(unit = Units.normalize(it.unit), updatedAt = t, dirty = true) })
            changed += untidyLines.size
        }
        onChange()
        return changed
    }

    /** In-stock labels of [p]: same group, code, size and unit. */
    suspend fun stockOf(p: Product): List<Item> =
        dao.inStockOfCode(p.code).first().filter { it.category == p.groupId && it.size == p.size && it.unit == p.unit }

    suspend fun hideProduct(id: String, hidden: Boolean = true) {
        val p = dao.product(id) ?: return
        dao.putProducts(listOf(p.copy(hidden = hidden, updatedAt = now(), dirty = true)))
        onChange()
    }

    /** Adds a group, or saves a changed one. Returns its ID. */
    suspend fun saveGroup(id: String?, name: String, unit: String, pack: String): String {
        val label = name.trim()
        require(label.isNotEmpty()) { "Enter a name" }
        require(unit.isNotBlank()) { "Enter a unit" }
        val all = dao.allGroups()
        require(all.none { it.id != id && !it.hidden && it.name.trim().equals(label, ignoreCase = true) }) { "There is already a group called $label" }
        val t = now()
        val existing = all.firstOrNull { it.id == id }
        val row = if (existing != null) {
            existing.copy(name = label, unit = unit.trim(), pack = pack.trim().ifEmpty { "pack" }, hidden = false, updatedAt = t, dirty = true)
        } else {
            var newId = Category.newId(label)
            var n = 2
            while (all.any { it.id == newId }) newId = Category.newId(label) + "_" + n++
            GroupRow(newId, label, unit.trim(), pack.trim().ifEmpty { "pack" }, (all.maxOfOrNull { it.sort } ?: 0) + 1, false, t)
        }
        dao.putGroups(listOf(row))
        onChange()
        return row.id
    }

    suspend fun hideGroup(id: String, hidden: Boolean = true) {
        require(id != Category.OTHER.name) { "Other cannot be removed" }
        val g = dao.group(id) ?: return
        dao.putGroups(listOf(g.copy(hidden = hidden, updatedAt = now(), dirty = true)))
        onChange()
    }

    // ---------- users ----------

    private fun sameName(a: String, b: String) = CustomerNames.key(a) == CustomerNames.key(b)

    suspend fun addUser(name: String, role: String, canReceive: Boolean, pin: String): AppUser {
        val clean = CustomerNames.clean(name)
        require(clean.isNotEmpty()) { "Enter a name" }
        require(Pin.valid(pin)) { "PIN must be ${Pin.MIN} to ${Pin.MAX} digits" }
        require(dao.allUsers().none { sameName(it.name, clean) }) { "There is already a user called $clean" }
        val salt = Pin.newSalt()
        val u = AppUser(uuid(), clean, role, canReceive, true, Pin.hash(pin, salt), salt, now())
        dao.putUsers(listOf(u))
        onChange()
        return u
    }

    /** Changes name, role, receive permission or active; at least one active admin always stays. */
    suspend fun updateUser(id: String, name: String, role: String, canReceive: Boolean, active: Boolean): AppUser {
        val all = dao.allUsers()
        val u = all.firstOrNull { it.id == id } ?: error("User not found")
        val clean = CustomerNames.clean(name)
        require(clean.isNotEmpty()) { "Enter a name" }
        require(all.none { it.id != id && sameName(it.name, clean) }) { "There is already a user called $clean" }
        val stillAdmin = role == Roles.ADMIN && active
        if (u.isAdmin && u.active && !stillAdmin) {
            check(all.any { it.id != id && it.isAdmin && it.active }) { "Keep at least one active admin" }
        }
        val updated = u.copy(name = clean, role = role, canReceive = canReceive, active = active, updatedAt = now(), dirty = true)
        dao.putUsers(listOf(updated))
        onChange()
        return updated
    }

    suspend fun setPin(id: String, pin: String) {
        require(Pin.valid(pin)) { "PIN must be ${Pin.MIN} to ${Pin.MAX} digits" }
        val u = dao.user(id) ?: error("User not found")
        val salt = Pin.newSalt()
        dao.putUsers(listOf(u.copy(pinHash = Pin.hash(pin, salt), salt = salt, updatedAt = now(), dirty = true)))
        onChange()
    }

    // ---------- requests ----------

    private suspend fun checkNotWaiting(targets: List<String>) {
        val waiting = dao.pendingRequestsNow().flatMap { it.targets }.toSet()
        check(targets.none { it in waiting }) { "Already waiting for an admin" }
    }

    private suspend fun newRequest(kind: String, target: String, summary: String, reason: String, payload: String = ""): ChangeRequest {
        val t = now()
        val r = ChangeRequest(
            id = uuid(), kind = kind, target = target, summary = summary, reason = reason.trim(),
            requestedBy = prefs.userName, device = prefs.deviceCode, requestedAt = t, updatedAt = t,
            notified = RequestStatus.PENDING, payload = payload,
        )
        dao.putRequests(listOf(r))
        onChange()
        return r
    }

    /** Asks an admin to undo a ship-out, cut or write-off. Nothing changes until it is approved. */
    suspend fun requestUndo(movementId: String, reason: String): ChangeRequest {
        val m = dao.movement(movementId) ?: error("Not found")
        check(m.type in setOf(MovementType.OUT, MovementType.CUT, MovementType.WASTE)) { "Only ship-outs, cuts and waste can be undone" }
        check(movementId !in dao.undoneIdsNow()) { "This was already undone" }
        checkNotWaiting(listOf(movementId))
        val noun = when (m.type) { MovementType.CUT -> "cut"; MovementType.WASTE -> "write-off"; else -> "ship-out" }
        val to = if (m.type != MovementType.WASTE && m.reference.isNotBlank()) " to ${m.reference}" else ""
        val by = if (m.user.isNotBlank() && m.user != prefs.userName) " (done by ${m.user})" else ""
        return newRequest(
            RequestKind.UNDO, movementId,
            "Undo $noun ${Format.qtyUnit(m.qty, m.unit)} of ${m.code} (${m.itemId})$to$by", reason,
        )
    }

    /** Asks an admin to delete labels entered by mistake. */
    suspend fun requestDelete(itemIds: List<String>, reason: String): ChangeRequest {
        val items = itemIds.chunked(500).flatMap { dao.itemsByIds(it) }.filter { it.status == ItemStatus.IN_STOCK }
        check(items.isNotEmpty()) { "Nothing in stock to delete" }
        checkNotWaiting(items.map { it.id })
        val summary = if (items.size == 1) {
            val i = items.first()
            "Delete ${i.id} · ${i.code} · ${Format.qtyUnit(i.remaining, i.unit)}"
        } else {
            "Delete ${items.size} labels of ${items.map { it.code }.distinct().joinToString(", ")} · " +
                items.groupBy { it.unit }.entries.joinToString(", ") { (u, l) -> Format.qtyUnit(l.sumOf { it.remaining }, u) }
        }
        return newRequest(RequestKind.DELETE, items.joinToString(",") { it.id }, summary, reason)
    }

    /** Asks an admin to correct category, code, size or unit of labels. */
    suspend fun requestEdit(itemIds: List<String>, edit: ItemEdit, reason: String): ChangeRequest {
        val items = itemIds.chunked(500).flatMap { dao.itemsByIds(it) }.filter { it.status == ItemStatus.IN_STOCK }
        val first = items.firstOrNull { edit.against(it) != null } ?: error("Nothing would change")
        checkNotWaiting(items.map { it.id })
        val what = edit.against(first)!!.describe(first)
        val summary = (if (items.size == 1) "Edit ${first.id}" else "Edit ${items.size} labels of ${first.code}") + ": $what"
        return newRequest(RequestKind.EDIT, items.joinToString(",") { it.id }, summary, reason, edit.toJson())
    }

    /** Carries out the request as [admin] and marks it approved. Throws, leaving it waiting, if it cannot be done. */
    suspend fun approveRequest(id: String, admin: String) {
        val r = dao.request(id) ?: error("Request not found")
        check(r.status == RequestStatus.PENDING) { "Already ${r.status.lowercase()} by ${r.decidedBy}" }
        when (r.kind) {
            RequestKind.UNDO -> {
                if (r.target !in dao.undoneIdsNow()) {
                    dao.movement(r.target) ?: error("${r.requestedBy}'s change has not reached this phone yet. Sync and try again.")
                    undoShipOut(r.target, admin)
                }
            }
            RequestKind.DELETE -> voidItems(r.targets, admin)
            RequestKind.EDIT -> {
                check(r.payload.isNotBlank()) { "The new values did not reach this phone. Update the Apps Script to 2.1.0 and sync." }
                editItems(r.targets, ItemEdit.fromJson(r.payload), admin)
            }
            else -> error("Unknown request")
        }
        decide(r, RequestStatus.APPROVED, admin, "")
    }

    suspend fun rejectRequest(id: String, admin: String, note: String) {
        val r = dao.request(id) ?: error("Request not found")
        check(r.status == RequestStatus.PENDING) { "Already ${r.status.lowercase()} by ${r.decidedBy}" }
        decide(r, RequestStatus.REJECTED, admin, note)
    }

    private suspend fun decide(r: ChangeRequest, status: String, admin: String, note: String) {
        val t = now()
        dao.putRequests(
            listOf(r.copy(status = status, decidedBy = admin, decidedAt = t, note = note.trim(), updatedAt = t, dirty = true, notified = status))
        )
        onChange()
    }
}
