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
    /** Entered by mistake and deleted; kept in the sheet as a record, hidden everywhere else. */
    const val VOID = "VOID"
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
    const val VOID = "VOID"
    const val MOVE = "MOVE"
    /** Metres cut from a roll for a customer. */
    const val CUT = "CUT"
    /** A short end written off after a cut. */
    const val WASTE = "WASTE"
    /** Cancels a ship-out, cut or waste made by mistake; [Movement.reference] holds the cancelled movement's ID. */
    const val UNDO = "UNDO"
}

/** A customer in the shared library, offered while typing names. */
@Entity(tableName = "customers")
data class Customer(
    @PrimaryKey val id: String,
    val name: String,
    val createdAt: Long,
    val createdBy: String,
    val updatedAt: Long,
    /** Removed from suggestions; kept so old reports still show the name. */
    val hidden: Boolean = false,
    val dirty: Boolean = true,
)

/** A product the app has seen, offered as a suggestion when typing a code. */
data class ProductHint(
    val category: String,
    val code: String,
    val size: String,
    val unit: String,
    val qty: Double,
    val lastUsed: Long,
)

/** Append-only log of stock changes. */
@Entity(tableName = "movements", indices = [Index("itemId"), Index("at")])
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
    /** Name of the person who did it, from Settings on that phone. */
    val user: String = "",
    val customer: String = "",
    val invoice: String = "",
)
