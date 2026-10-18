package com.zinax.stock

import com.zinax.stock.data.Item
import com.zinax.stock.data.ItemStatus
import com.zinax.stock.data.LowStock
import com.zinax.stock.data.Product
import org.junit.Assert.assertEquals
import org.junit.Test

class LowStockTest {
    private fun product(id: String, code: String, min: Double, size: String = "", hidden: Boolean = false) =
        Product(id, "RAIL", code, size, "pcs", 15.0, "", hidden, 1, minQty = min)

    private fun item(id: String, code: String, left: Double, size: String = "", status: String = ItemStatus.IN_STOCK) =
        Item(id, "RAIL", code, size, "pcs", 15.0, left, status, null, null, null, null, 1, "", "A", 1)

    @Test
    fun lists_products_at_or_under_their_minimum_empty_first() {
        val products = listOf(
            product("a", "KG10-300", 30.0),
            product("b", "KG10-350", 30.0),
            product("c", "KG10-500", 30.0),
            product("d", "KG10-600", 0.0),
            product("e", "KG10-700", 10.0, hidden = true),
        )
        val items = listOf(
            item("1", "KG10-300", 15.0), item("2", "kg10-300 ", 15.0), // 30: at the minimum
            item("3", "KG10-350", 15.0), item("4", "KG10-350", 15.0), item("5", "KG10-350", 15.0), // 45: fine
            item("6", "KG10-500", 15.0, status = ItemStatus.SHIPPED), // shipped does not count: empty
        )
        val low = LowStock.lines(products, items)
        assertEquals(listOf("KG10-500", "KG10-300"), low.map { it.product.code })
        assertEquals(true, low[0].empty)
        assertEquals(30.0, low[0].short, 1e-9)
        assertEquals(2, low[1].packages)
        assertEquals(0.0, low[1].short, 1e-9)
    }

    @Test
    fun size_must_match() {
        val low = LowStock.lines(listOf(product("a", "101", 100.0, size = "0.30*1400")), listOf(item("1", "101", 500.0, size = "0.30*1220")))
        assertEquals(1, low.size)
        assertEquals(0.0, low[0].have, 1e-9)
    }
}
