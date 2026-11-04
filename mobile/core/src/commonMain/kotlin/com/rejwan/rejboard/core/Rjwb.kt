package com.rejwan.rejboard.core

import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlinx.serialization.json.JsonObject

class RjwbException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The .rjwb board file: `RJWB1:` followed by base64 of the UTF-8 board JSON. This is what the desktop app's
 * "Save a copy" and the sync folder write, and what "Open" and the sync folder read (index.html openBoardFile / sfParse).
 */
@OptIn(ExperimentalEncodingApi::class)
object Rjwb {
    const val MAGIC = "RJWB1:"

    private val base64 = Base64.Default.withPadding(Base64.PaddingOption.PRESENT_OPTIONAL)
    private val space = Regex("[\\t\\n\\f\\r ]")

    fun isRjwb(text: String): Boolean = text.startsWith(MAGIC)

    /** Board JSON text inside a .rjwb file. Like atob(), white space inside the base64 is ignored. */
    fun decodeJson(text: String): String {
        if (!isRjwb(text)) throw RjwbException("That is not a RejBoard file")
        val body = text.substring(MAGIC.length).replace(space, "")
        val bytes = try {
            base64.decode(body)
        } catch (e: IllegalArgumentException) {
            throw RjwbException("The board file is damaged (bad base64)", e)
        }
        return bytes.decodeToString()
    }

    fun decode(text: String): Board {
        val json = decodeJson(text)
        val root = try {
            BoardJson.parse(json)
        } catch (e: Exception) {
            throw RjwbException("The board file is damaged (bad JSON)", e)
        }
        return Board(root as? JsonObject ?: throw RjwbException("The board file holds no board"))
    }

    fun encodeJson(json: String): String = MAGIC + base64.encode(json.encodeToByteArray())

    fun encode(board: Board): String = encodeJson(board.toJson())
}
