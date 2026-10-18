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

    @Query("SELECT * FROM expected WHERE labelId = :labelId LIMIT 1")
    suspend fun expectedByLabel(labelId: String): ExpectedUnit?

    /** Cartons the supplier labelled, for the receive-by-scan progress. */
    @Query("SELECT * FROM expected WHERE labelId IS NOT NULL")
    fun prelabelled(): Flow<List<ExpectedUnit>>

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
    @Query("SELECT * FROM movements WHERE at >= :from AND at < :to ORDER BY at")
    fun movementsBetweenAll(from: Long, to: Long): Flow<List<Movement>>

    @Query("SELECT * FROM movements WHERE type = :type AND at >= :from AND at < :to ORDER BY at")
    fun movementsBetween(type: String, from: Long, to: Long): Flow<List<Movement>>

    @Query("SELECT * FROM movements WHERE type = :type AND at >= :from AND at < :to ORDER BY at")
    suspend fun movementsBetweenNow(type: String, from: Long, to: Long): List<Movement>

    @Query("SELECT * FROM movements WHERE id = :id")
    suspend fun movement(id: String): Movement?

    /** Ship-outs of one package, newest first. */
    @Query("SELECT * FROM movements WHERE itemId = :itemId AND type = 'OUT' ORDER BY at DESC")
    fun shipOutsOf(itemId: String): Flow<List<Movement>>

    @Query("SELECT COUNT(*) FROM movements WHERE itemId = :itemId AND type = 'CUT'")
    suspend fun cutCount(itemId: String): Int

    /** Ship-outs and cuts of one package that can still be undone, newest first. */
    @Query("SELECT * FROM movements WHERE itemId = :itemId AND type IN ('OUT', 'CUT', 'WASTE', 'DAMAGE') ORDER BY at DESC")
    fun takenFrom(itemId: String): Flow<List<Movement>>

    @Query("SELECT * FROM movements WHERE type IN ('OUT', 'CUT', 'WASTE', 'DAMAGE') AND at >= :since ORDER BY at DESC")
    fun takenSince(since: Long): Flow<List<Movement>>

    /** In-stock packages of one code, for cutting. */
    @Query("SELECT * FROM items WHERE status = 'IN_STOCK' AND code = :code ORDER BY receivedAt")
    fun inStockOfCode(code: String): Flow<List<Item>>

    // groups and products
    @Query("SELECT * FROM product_groups ORDER BY sort, name COLLATE NOCASE")
    fun groups(): Flow<List<GroupRow>>

    @Query("SELECT * FROM product_groups")
    suspend fun allGroups(): List<GroupRow>

    @Query("SELECT * FROM product_groups WHERE id = :id")
    suspend fun group(id: String): GroupRow?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putGroups(rows: List<GroupRow>)

    @Query("SELECT * FROM product_groups WHERE dirty = 1")
    suspend fun dirtyGroups(): List<GroupRow>

    @Query("UPDATE product_groups SET dirty = 0 WHERE id IN (:ids) AND updatedAt <= :upTo")
    suspend fun cleanGroups(ids: List<String>, upTo: Long)

    @Query("SELECT * FROM products ORDER BY code COLLATE NOCASE, size")
    fun products(): Flow<List<Product>>

    @Query("SELECT * FROM products")
    suspend fun allProducts(): List<Product>

    @Query("SELECT * FROM products WHERE id = :id")
    suspend fun product(id: String): Product?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putProducts(rows: List<Product>)

    @Query("SELECT * FROM products WHERE dirty = 1")
    suspend fun dirtyProducts(): List<Product>

    @Query("UPDATE products SET dirty = 0 WHERE id IN (:ids) AND updatedAt <= :upTo")
    suspend fun cleanProducts(ids: List<String>, upTo: Long)

    @Query("SELECT category, code, size, unit, qty FROM items UNION ALL SELECT category, code, size, unit, qty FROM expected")
    suspend fun itemProducts(): List<ItemProduct>

    // users
    @Query("SELECT * FROM users ORDER BY name COLLATE NOCASE")
    fun users(): Flow<List<AppUser>>

    @Query("SELECT * FROM users")
    suspend fun allUsers(): List<AppUser>

    @Query("SELECT * FROM users WHERE id = :id")
    suspend fun user(id: String): AppUser?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putUsers(rows: List<AppUser>)

    @Query("SELECT * FROM users WHERE dirty = 1")
    suspend fun dirtyUsers(): List<AppUser>

    @Query("UPDATE users SET dirty = 0 WHERE id IN (:ids) AND updatedAt <= :upTo")
    suspend fun cleanUsers(ids: List<String>, upTo: Long)

    // requests
    @Query("SELECT * FROM requests ORDER BY requestedAt DESC LIMIT 300")
    fun requests(): Flow<List<ChangeRequest>>

    @Query("SELECT * FROM requests WHERE status = 'PENDING' ORDER BY requestedAt")
    fun pendingRequests(): Flow<List<ChangeRequest>>

    @Query("SELECT * FROM requests WHERE status = 'PENDING'")
    suspend fun pendingRequestsNow(): List<ChangeRequest>

    @Query("SELECT * FROM requests WHERE id = :id")
    suspend fun request(id: String): ChangeRequest?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putRequests(rows: List<ChangeRequest>)

    @Query("SELECT * FROM requests WHERE dirty = 1")
    suspend fun dirtyRequests(): List<ChangeRequest>

    @Query("UPDATE requests SET dirty = 0 WHERE id IN (:ids) AND updatedAt <= :upTo")
    suspend fun cleanRequests(ids: List<String>, upTo: Long)

    @Query("SELECT * FROM requests WHERE status != notified")
    suspend fun requestsToNotify(): List<ChangeRequest>

    @Query("UPDATE requests SET notified = :status WHERE id = :id")
    suspend fun setNotified(id: String, status: String)

    // customers
    @Query("SELECT * FROM customers WHERE hidden = 0 ORDER BY name COLLATE NOCASE")
    fun customers(): Flow<List<Customer>>

    @Query("SELECT * FROM customers")
    suspend fun allCustomers(): List<Customer>

    @Query("SELECT * FROM customers WHERE id = :id")
    suspend fun customer(id: String): Customer?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putCustomers(rows: List<Customer>)

    @Query("SELECT * FROM customers WHERE dirty = 1")
    suspend fun dirtyCustomers(): List<Customer>

    @Query("UPDATE customers SET dirty = 0 WHERE id IN (:ids) AND updatedAt <= :upTo")
    suspend fun cleanCustomers(ids: List<String>, upTo: Long)

    /** IDs of ship-outs that were undone. */
    @Query("SELECT reference FROM movements WHERE type = 'UNDO'")
    fun undoneIds(): Flow<List<String>>

    @Query("SELECT reference FROM movements WHERE type = 'UNDO'")
    suspend fun undoneIdsNow(): List<String>

    /** The UNDO rows themselves: [Movement.reference] is the cancelled movement, [Movement.user] who cancelled it. */
    @Query("SELECT * FROM movements WHERE type = 'UNDO'")
    suspend fun undoMovementsNow(): List<Movement>

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
