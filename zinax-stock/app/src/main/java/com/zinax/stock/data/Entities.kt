package com.zinax.stock.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.zinax.stock.core.Category

/** An imported packing list. */
@Entity(tableName = "shipments")
data class Shipment(
    @PrimaryKey val id: String,
    val name: String,
    val source: String,
    val createdAt: Long,
    val updatedAt: Long,
    val dirty: Boolean = true,
)

/** One package the packing list says should arrive. [itemId] is set once its label is printed. */
@Entity(tableName = "expected", indices = [Index("shipmentId"), Index("itemId")])
data class ExpectedUnit(
    @PrimaryKey val id: String,
    val shipmentId: String,
    val pallet: String,
    val lineNo: Int,
    val category: String,
    val code: String,
    val size: String,
    val qty: Double,
    val unit: String,
    val netKg: Double?,
    val grossKg: Double?,
    val itemId: String?,
    val updatedAt: Long,
    val dirty: Boolean = true,
)

object ItemStatus {
    const val IN_STOCK = "IN_STOCK"
    const val SHIPPED = "SHIPPED"
}

/** A labelled package in the warehouse. [id] is the text in the QR code. */
@Entity(tableName = "items", indices = [Index("code"), Index("shipmentId"), Index("status")])
data class Item(
    @PrimaryKey val id: String,
    val category: String,
    val code: String,
    val size: String,
    val unit: String,
    val qty: Double,
    val remaining: Double,
    val status: String,
    val shipmentId: String?,
    val pallet: String?,
    val netKg: Double?,
    val grossKg: Double?,
    val receivedAt: Long,
    val location: String,
    val device: String,
    val updatedAt: Long,
    val dirty: Boolean = true,
) {
    val categoryEnum: Category get() = Category.fromName(category)
}

object MovementType {
    const val IN = "IN"
    const val OUT = "OUT"
}

/** Append-only log of stock changes. */
@Entity(tableName = "movements", indices = [Index("itemId")])
data class Movement(
    @PrimaryKey val id: String,
    val itemId: String,
    val type: String,
    val qty: Double,
    val reference: String,
    val at: Long,
    val device: String,
    val code: String,
    val size: String,
    val unit: String,
    val dirty: Boolean = true,
)
