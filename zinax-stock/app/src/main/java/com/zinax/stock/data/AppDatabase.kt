package com.zinax.stock.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [Shipment::class, ExpectedUnit::class, Item::class, Movement::class, Customer::class],
    version = 3,
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

        fun create(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "zinax.db")
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                .build()
    }
}
