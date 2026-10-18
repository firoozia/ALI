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
    /** Label ID the supplier printed on this carton; scanning it receives the unit. Null for lists labelled here. */
    val labelId: String? = null,
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
    /** Material found damaged on a roll and taken out of stock; the reason is in the reference. */
    const val DAMAGE = "DAMAGE"
    /** Category, code, size or unit corrected by an admin; [Movement.reference] says what changed. */
    const val EDIT = "EDIT"
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

object Roles {
    const val ADMIN = "ADMIN"
    const val USER = "USER"
}

/** A person who signs in with a PIN. Shared by the phones through the Users tab. */
@Entity(tableName = "users")
data class AppUser(
    @PrimaryKey val id: String,
    val name: String,
    /** [Roles.ADMIN] or [Roles.USER]. */
    val role: String,
    /** A user who may receive goods and print labels. Admins always can. */
    val canReceive: Boolean = false,
    val active: Boolean = true,
    val pinHash: String,
    val salt: String,
    val updatedAt: Long,
    val dirty: Boolean = true,
) {
    val isAdmin: Boolean get() = role == Roles.ADMIN
    val mayReceive: Boolean get() = isAdmin || canReceive
}

object RequestKind {
    /** Undo a ship-out, cut or write-off; the target is the movement ID. */
    const val UNDO = "UNDO"
    /** Delete labels entered by mistake; the target is the item IDs, comma separated. */
    const val DELETE = "DELETE"
    /** Correct category, code, size or unit; the target is the item IDs, the new values are in [ChangeRequest.payload]. */
    const val EDIT = "EDIT"
    /** Report damaged material on a roll; the target is the item ID, qty and reason are in [ChangeRequest.payload]. */
    const val DAMAGE = "DAMAGE"
}

object RequestStatus {
    const val PENDING = "PENDING"
    const val APPROVED = "APPROVED"
    const val REJECTED = "REJECTED"
}

/** A user's undo or delete, waiting for an admin. Shared through the Requests tab. */
@Entity(tableName = "requests")
data class ChangeRequest(
    @PrimaryKey val id: String,
    val kind: String,
    val target: String,
    /** What it changes, in words, e.g. "Undo cut 20 m of 101 (ZX-251009-A0003) to Bahar". */
    val summary: String,
    val reason: String,
    val requestedBy: String,
    val device: String,
    val requestedAt: Long,
    val status: String = RequestStatus.PENDING,
    val decidedBy: String = "",
    val decidedAt: Long = 0,
    val note: String = "",
    val updatedAt: Long,
    val dirty: Boolean = true,
    /** This phone only: the status a notification was last shown (or not needed) for. */
    val notified: String = "",
    /** Extra data for the request, e.g. the new values of an edit as JSON. */
    val payload: String = "",
) {
    val targets: List<String> get() = target.split(',').map { it.trim() }.filter { it.isNotEmpty() }
}

/** A product group (PVC film, Edge banding…, or one an admin added). Shared through the Groups tab. */
@Entity(tableName = "product_groups")
data class GroupRow(
    /** Stored on labels: a built-in name like "PVC", or "G_…" for added groups. */
    @PrimaryKey val id: String,
    val name: String,
    val unit: String,
    /** What one package is called: roll, gallon, bag, carton… */
    val pack: String,
    val sort: Int,
    val hidden: Boolean = false,
    val updatedAt: Long,
    val dirty: Boolean = true,
)

/** A product in the catalog: group, code, size, unit, usual quantity per package and a note. Shared through the Products tab. */
@Entity(tableName = "products")
data class Product(
    @PrimaryKey val id: String,
    val groupId: String,
    val code: String,
    val size: String,
    val unit: String,
    /** Usual quantity in one package, 0 when not set. */
    val packQty: Double,
    /** Colour name or description, shown in the app only. */
    val note: String,
    val hidden: Boolean = false,
    val updatedAt: Long,
    val dirty: Boolean = true,
)

/** Group, code, size, unit and package quantity of a label, for building the first catalog. */
data class ItemProduct(val category: String, val code: String, val size: String, val unit: String, val qty: Double)

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
