package dev.codex.blecontrol

import java.util.Locale
import java.util.UUID

object BleProtocol {
    private fun pairingBytes(pairingId: String): Pair<Int, Int> {
        val text = pairingId.trim().lowercase(Locale.US)
        require(Regex("^[0-9a-f]{1,4}$").matches(text)) { "invalid_pairing_id" }
        val padded = text.padStart(4, '0')
        return Pair(padded.substring(0, 2).toInt(16), padded.substring(2, 4).toInt(16))
    }

    fun checksum(bytes15: List<Int>): Int {
        require(bytes15.size == 15) { "checksum_requires_15_bytes" }
        return bytes15.sum() and 0xff
    }

    private fun uuidFromBytes(bytes: List<Int>): String {
        val hex = bytes.joinToString("") { "%02x".format(Locale.US, it and 0xff) }
        return listOf(
            hex.substring(0, 8),
            hex.substring(8, 12),
            hex.substring(12, 16),
            hex.substring(16, 20),
            hex.substring(20, 32),
        ).joinToString("-")
    }

    private fun assertLevel(level: Int) {
        require(level in 0..100) { "invalid_level" }
    }

    private fun buildUuid(firstBytes: List<Int>, pairingId: String, tailBytes: List<Int>): String {
        val (pairHi, pairLo) = pairingBytes(pairingId)
        val bytes15 = firstBytes + listOf(pairHi, pairLo) + tailBytes
        return uuidFromBytes(bytes15 + checksum(bytes15))
    }

    fun buildSuctionUuid(pairingId: String, level: Int): String {
        assertLevel(level)
        return buildUuid(
            listOf(0x71, 0x00, 0x02, 0xdb, 0x04, 0x00),
            pairingId,
            listOf(0x03, 0x02, level, 0x00, 0x00, 0x00, 0x00),
        )
    }

    fun buildVibrationUuid(pairingId: String, level: Int): String {
        assertLevel(level)
        return buildUuid(
            listOf(0x71, 0x00, 0x02, 0xf8, 0x04, 0x00),
            pairingId,
            listOf(0x05, 0x0a, level, 0x00, 0x00, 0x00, 0x00),
        )
    }

    fun buildStopSuctionUuid(pairingId: String): String {
        return buildUuid(
            listOf(0x71, 0x00, 0x02, 0xdf, 0x04, 0x00),
            pairingId,
            listOf(0x03, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00),
        )
    }

    fun buildStopVibrationUuid(pairingId: String): String {
        return buildUuid(
            listOf(0x71, 0x00, 0x02, 0xed, 0x04, 0x00),
            pairingId,
            listOf(0x06, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00),
        )
    }

    fun asUuid(uuidText: String): UUID = UUID.fromString(uuidText)
}
