package com.zinax.stock.data

import androidx.room.withTransaction
import com.zinax.stock.core.Category
import com.zinax.stock.core.CustomerNames
import com.zinax.stock.core.CutPlan
import com.zinax.stock.core.Format
import com.zinax.stock.core.LabelId
import com.zinax.stock.importer.ParsedUnit
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
                category = it.category.name, code = it.code, size = it.size, qty = it.qty, unit = it.unit,
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
                    id = id, category = category.name, code = code.trim(), size = size.trim(), unit = unit.trim(),
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
    suspend fun undoShipOut(movementId: String) {
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
                        at = t, device = prefs.deviceCode, code = item.code, size = item.size, unit = item.unit, user = prefs.userName,
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
    suspend fun voidItems(itemIds: List<String>) {
        db.withTransaction {
            val t = now()
            val items = itemIds.chunked(500).flatMap { dao.itemsByIds(it) }.filter { it.status == ItemStatus.IN_STOCK }
            if (items.isEmpty()) return@withTransaction
            dao.putItems(items.map { it.copy(status = ItemStatus.VOID, remaining = 0.0, updatedAt = t, dirty = true) })
            dao.putMovements(
                items.map {
                    Movement(
                        id = uuid(), itemId = it.id, type = MovementType.VOID, qty = it.remaining, reference = "Deleted",
                        at = t, device = prefs.deviceCode, code = it.code, size = it.size, unit = it.unit, user = prefs.userName,
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
}
