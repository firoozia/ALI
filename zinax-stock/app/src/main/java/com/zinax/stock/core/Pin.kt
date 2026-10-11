package com.zinax.stock.core

import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** PINs are stored only as a salted, slow hash, on the phones and in the Users tab. */
object Pin {
    const val MIN = 4
    const val MAX = 6
    private const val ROUNDS = 12_000

    fun valid(pin: String): Boolean = pin.length in MIN..MAX && pin.all { it in '0'..'9' }

    fun newSalt(): String = ByteArray(16).also { SecureRandom().nextBytes(it) }.toHex()

    fun hash(pin: String, salt: String): String {
        val spec = PBEKeySpec(pin.toCharArray(), salt.toByteArray(Charsets.UTF_8), ROUNDS, 256)
        return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(spec).encoded.toHex()
    }

    fun matches(pin: String, salt: String, hash: String): Boolean = hash.isNotEmpty() && hash(pin, salt) == hash

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}
