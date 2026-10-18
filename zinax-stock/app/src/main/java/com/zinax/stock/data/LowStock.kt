package com.zinax.stock.data

/** A product with a minimum set whose stock is at or under it. */
data class LowLine(val product: Product, val have: Double, val packages: Int) {
    val empty get() = have <= 1e-6
    /** How much brings it back to the minimum. */
    val short get() = (product.minQty - have).coerceAtLeast(0.0)
}

/** Compares stock with the minimum set on each product in the catalog. */
object LowStock {
    fun key(category: String, code: String, size: String, unit: String) =
        listOf(category, code.trim(), size.trim(), unit.trim()).joinToString("|").lowercase()

    /** Products at or under their minimum, empty ones first, then the furthest under. */
    fun lines(products: List<Product>, inStock: List<Item>): List<LowLine> {
        val stock = inStock.filter { it.status == ItemStatus.IN_STOCK }.groupBy { key(it.category, it.code, it.size, it.unit) }
        return products.filter { !it.hidden && it.minQty > 0 }
            .map { p ->
                val items = stock[key(p.groupId, p.code, p.size, p.unit)].orEmpty()
                LowLine(p, items.sumOf { it.remaining }, items.size)
            }
            .filter { it.have <= it.product.minQty + 1e-6 }
            .sortedWith(compareBy<LowLine>({ !it.empty }, { it.have / it.product.minQty }, { it.product.code }))
    }
}
