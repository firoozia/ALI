package com.zinax.stock.data

import androidx.room.withTransaction
import com.zinax.stock.core.Category
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
    ): List<Item> = idLock.withLock {
        db.withTransaction {
            val t = now()
            val items = nextIds(count).map { id ->
                Item(
                    id = id, category = category.name, code = code.trim(), size = size.trim(), unit = unit.trim(),
                    qty = qty, remaining = qty, status = ItemStatus.IN_STOCK,
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
        id = uuid(), itemId = item.id, type = MovementType.IN, qty = item.qty, reference = item.pallet?.let { "Pallet $it" } ?: "Manual",
        at = t, device = prefs.deviceCode, code = item.code, size = item.size, unit = item.unit, user = prefs.userName,
    )

    /** Ships [qty] out of [itemId]. A package is marked shipped when nothing is left. */
    suspend fun shipOut(itemId: String, qty: Double, reference: String): Item {
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
                        id = uuid(), itemId = item.id, type = MovementType.OUT, qty = qty, reference = reference.trim(),
                        at = t, device = prefs.deviceCode, code = item.code, size = item.size, unit = item.unit, user = prefs.userName,
                    )
                )
            )
            updated
        }
        onChange()
        return result
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
