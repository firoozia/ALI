package com.zinax.stock.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [Shipment::class, ExpectedUnit::class, Item::class, Movement::class, Customer::class, AppUser::class, ChangeRequest::class],
    version = 5,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun dao(): StockDao

    companion object {
        /** 1.6.0: movements record who did them. */
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE movements ADD COLUMN user TEXT NOT NULL DEFAULT ''")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_movements_at ON movements (at)")
            }
        }

        /** 1.8.0: cuts record customer and invoice; customer library. */
        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE movements ADD COLUMN customer TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE movements ADD COLUMN invoice TEXT NOT NULL DEFAULT ''")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `customers` (`id` TEXT NOT NULL, `name` TEXT NOT NULL, " +
                        "`createdAt` INTEGER NOT NULL, `createdBy` TEXT NOT NULL, `updatedAt` INTEGER NOT NULL, " +
                        "`hidden` INTEGER NOT NULL, `dirty` INTEGER NOT NULL, PRIMARY KEY(`id`))"
                )
            }
        }

        /** 1.9.0: users with PINs, and undo or delete requests waiting for an admin. */
        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `users` (`id` TEXT NOT NULL, `name` TEXT NOT NULL, `role` TEXT NOT NULL, " +
                        "`canReceive` INTEGER NOT NULL, `active` INTEGER NOT NULL, `pinHash` TEXT NOT NULL, `salt` TEXT NOT NULL, " +
                        "`updatedAt` INTEGER NOT NULL, `dirty` INTEGER NOT NULL, PRIMARY KEY(`id`))"
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `requests` (`id` TEXT NOT NULL, `kind` TEXT NOT NULL, `target` TEXT NOT NULL, " +
                        "`summary` TEXT NOT NULL, `reason` TEXT NOT NULL, `requestedBy` TEXT NOT NULL, `device` TEXT NOT NULL, " +
                        "`requestedAt` INTEGER NOT NULL, `status` TEXT NOT NULL, `decidedBy` TEXT NOT NULL, `decidedAt` INTEGER NOT NULL, " +
                        "`note` TEXT NOT NULL, `updatedAt` INTEGER NOT NULL, `dirty` INTEGER NOT NULL, `notified` TEXT NOT NULL, " +
                        "PRIMARY KEY(`id`))"
                )
            }
        }

        /** 2.1.0: requests carry extra data (the new values of an edit). */
        private val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE requests ADD COLUMN payload TEXT NOT NULL DEFAULT ''")
            }
        }

        fun create(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "zinax.db")
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
                .build()
    }
}
