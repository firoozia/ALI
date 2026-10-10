package com.zinax.stock.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface StockDao {
    // shipments
    @Query("SELECT * FROM shipments ORDER BY createdAt DESC")
    fun shipments(): Flow<List<Shipment>>

    @Query("SELECT * FROM shipments WHERE id = :id")
    suspend fun shipment(id: String): Shipment?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putShipments(rows: List<Shipment>)

    // expected units
    @Query("SELECT * FROM expected WHERE shipmentId = :shipmentId ORDER BY lineNo")
    fun expected(shipmentId: String): Flow<List<ExpectedUnit>>

    @Query("SELECT * FROM expected")
    fun allExpected(): Flow<List<ExpectedUnit>>

    @Query("SELECT * FROM expected WHERE id IN (:ids)")
    suspend fun expectedByIds(ids: List<String>): List<ExpectedUnit>

    @Query("SELECT * FROM expected WHERE id = :id")
    suspend fun expectedById(id: String): ExpectedUnit?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putExpected(rows: List<ExpectedUnit>)

    @Query("SELECT * FROM expected WHERE itemId IN (:itemIds)")
    suspend fun expectedByItemIds(itemIds: List<String>): List<ExpectedUnit>

    /** Every product seen on a label or a packing list, newest use per product. Deleted labels do not count. */
    @Query(
        "SELECT category, code, size, unit, qty, MAX(receivedAt) AS lastUsed FROM items WHERE status != 'VOID' " +
            "GROUP BY category, code, size, unit " +
            "UNION ALL " +
            "SELECT category, code, size, unit, qty, MAX(updatedAt) AS lastUsed FROM expected " +
            "GROUP BY category, code, size, unit"
    )
    fun productHints(): Flow<List<ProductHint>>

    // items
    @Query("SELECT * FROM items WHERE status = 'IN_STOCK' ORDER BY code, receivedAt")
    fun inStock(): Flow<List<Item>>

    @Query("SELECT * FROM items WHERE shipmentId = :shipmentId")
    fun itemsForShipment(shipmentId: String): Flow<List<Item>>

    @Query("SELECT * FROM items WHERE id = :id")
    suspend fun item(id: String): Item?

    @Query("SELECT * FROM items WHERE id IN (:ids)")
    suspend fun itemsByIds(ids: List<String>): List<Item>

    @Query(
        "SELECT * FROM items WHERE status = 'IN_STOCK' AND code = :code AND size = :size " +
            "AND receivedAt < :before AND id != :exclude ORDER BY receivedAt LIMIT 1"
    )
    suspend fun olderInStock(code: String, size: String, before: Long, exclude: String): Item?

    @Query("SELECT id FROM items WHERE id LIKE :prefix || '%' ORDER BY id DESC LIMIT 1")
    suspend fun lastIdWithPrefix(prefix: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putItems(rows: List<Item>)

    @Query("SELECT DISTINCT location FROM items WHERE location != '' ORDER BY location")
    fun usedLocations(): Flow<List<String>>

    // movements
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putMovements(rows: List<Movement>)

    @Query("SELECT * FROM movements WHERE type = 'OUT' AND at >= :since ORDER BY at DESC")
    fun shippedSince(since: Long): Flow<List<Movement>>

    /** Movements of one [type] (OUT, IN, VOID, MOVE) from [from] up to, not including, [to]. */
    @Query("SELECT * FROM movements WHERE type = :type AND at >= :from AND at < :to ORDER BY at")
    fun movementsBetween(type: String, from: Long, to: Long): Flow<List<Movement>>

    @Query("SELECT * FROM movements WHERE type = :type AND at >= :from AND at < :to ORDER BY at")
    suspend fun movementsBetweenNow(type: String, from: Long, to: Long): List<Movement>

    /** Movements pulled from the sheet; a movement never changes, so a known ID is skipped. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun putMovementsIfAbsent(rows: List<Movement>)

    // sync
    @Query("SELECT * FROM shipments WHERE dirty = 1")
    suspend fun dirtyShipments(): List<Shipment>

    @Query("SELECT * FROM expected WHERE dirty = 1")
    suspend fun dirtyExpected(): List<ExpectedUnit>

    @Query("SELECT * FROM items WHERE dirty = 1")
    suspend fun dirtyItems(): List<Item>

    @Query("SELECT * FROM movements WHERE dirty = 1")
    suspend fun dirtyMovements(): List<Movement>

    @Query("UPDATE shipments SET dirty = 0 WHERE id IN (:ids) AND updatedAt <= :upTo")
    suspend fun cleanShipments(ids: List<String>, upTo: Long)

    @Query("UPDATE expected SET dirty = 0 WHERE id IN (:ids) AND updatedAt <= :upTo")
    suspend fun cleanExpected(ids: List<String>, upTo: Long)

    @Query("UPDATE items SET dirty = 0 WHERE id IN (:ids) AND updatedAt <= :upTo")
    suspend fun cleanItems(ids: List<String>, upTo: Long)

    @Query("UPDATE movements SET dirty = 0 WHERE id IN (:ids)")
    suspend fun cleanMovements(ids: List<String>)

    @Query("SELECT COUNT(*) FROM items WHERE dirty = 1")
    fun pendingItemCount(): Flow<Int>
}
