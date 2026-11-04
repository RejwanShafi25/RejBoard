package com.rejwan.rejboard.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

class JsonWriteTest {
    @Test
    fun numbersAreWrittenLikeJavaScript() {
        val cases = listOf(
            1.5e-7 to "1.5e-7", 2e21 to "2e+21", 1e7 to "10000000", 0.00123 to "0.00123", 0.0001 to "0.0001",
            123.45 to "123.45", -0.5 to "-0.5", 1e-6 to "0.000001", 1e-7 to "1e-7", 1.2345e25 to "1.2345e+25", 0.0 to "0",
        )
        for ((v, js) in cases) assertEquals(js, jsFormat(v), "jsFormat($v)")
    }

    @Test
    fun parsedNumberTextIsKeptAsWritten() {
        val text = """{"a":[1.5e-7,2e+21,12345678901234567000,0.1,-3]}"""
        assertEquals(text, BoardJson.write(BoardJson.parse(text)))
    }

    @Test
    fun kotlinMadeNumbersAreRewritten() {
        assertEquals("[10000000,2,1.5e-7]", BoardJson.write(JsonArray(listOf(JsonPrimitive(1e7), JsonPrimitive(2.0), JsonPrimitive(1.5e-7)))))
    }

    @Test
    fun stringsAreEscapedLikeJsonStringify() {
        val s = "q\"b\\s\n\t\u0001é😀\uD800/"
        assertEquals("\"q\\\"b\\\\s\\n\\t\\u0001é😀\\ud800/\"", BoardJson.write(JsonPrimitive(s)))
    }
}
