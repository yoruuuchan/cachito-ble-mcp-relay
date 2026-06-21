package dev.codex.blecontrol

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class MainActivity : Activity() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val wsClient = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    private lateinit var urlInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var pairingInput: EditText
    private lateinit var statusText: TextView
    private lateinit var lastCommandText: TextView
    private lateinit var lastUuidText: TextView
    private lateinit var lastAdvertiseText: TextView
    private lateinit var errorText: TextView

    private var webSocket: WebSocket? = null
    private var connectAfterPermission = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
    }

    override fun onDestroy() {
        webSocket?.close(1000, "activity_destroyed")
        wsClient.dispatcher.executorService.shutdown()
        super.onDestroy()
    }

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }

        urlInput = editText("wss://example.com/phone/ws", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        tokenInput = editText("", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        pairingInput = editText("5002", InputType.TYPE_CLASS_TEXT)

        root.addView(label("Server WebSocket URL"))
        root.addView(urlInput)
        root.addView(label("Phone token"))
        root.addView(tokenInput)
        root.addView(label("Pairing ID"))
        root.addView(pairingInput)

        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        buttons.addView(Button(this).apply {
            text = "Connect"
            setOnClickListener { ensureBlePermissionsThenConnect() }
        })
        buttons.addView(Button(this).apply {
            text = "Disconnect"
            setOnClickListener { disconnect() }
        })
        root.addView(buttons)

        statusText = label("Status: offline")
        lastCommandText = label("Last command: none")
        lastUuidText = label("Last UUID: none")
        lastAdvertiseText = label("Last BLE advertise: none")
        errorText = label("Error: none")

        root.addView(statusText)
        root.addView(lastCommandText)
        root.addView(lastUuidText)
        root.addView(lastAdvertiseText)
        root.addView(errorText)

        return ScrollView(this).apply { addView(root) }
    }

    private fun label(text: String): TextView {
        return TextView(this).apply {
            this.text = text
            textSize = 16f
            setPadding(0, 14, 0, 6)
        }
    }

    private fun editText(value: String, inputTypeValue: Int): EditText {
        return EditText(this).apply {
            setText(value)
            inputType = inputTypeValue
            setSingleLine(true)
        }
    }

    private fun requiredBlePermissions(): Array<String> {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            emptyArray()
        }
    }

    private fun ensureBlePermissionsThenConnect() {
        val missing = requiredBlePermissions().filter {
            checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing.isEmpty()) {
            connect()
            return
        }

        connectAfterPermission = true
        requestPermissions(missing.toTypedArray(), 7)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 7 || !connectAfterPermission) {
            return
        }

        connectAfterPermission = false
        if (grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
            connect()
        } else {
            errorText.text = "Error: Bluetooth advertise/connect permission denied"
        }
    }

    private fun connect() {
        val url = urlInput.text.toString().trim()
        val token = tokenInput.text.toString()

        if (url.isEmpty() || token.isEmpty()) {
            errorText.text = "Error: WebSocket URL and Phone token are required"
            return
        }

        disconnect(closeCode = 1000, reason = "reconnect")

        val request = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $token")
            .build()

        statusText.text = "Status: connecting"
        errorText.text = "Error: none"

        webSocket = wsClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                runOnUiThread {
                    statusText.text = "Status: online"
                    errorText.text = "Error: none"
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runOnUiThread { handleServerMessage(text) }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                runOnUiThread { statusText.text = "Status: offline" }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                runOnUiThread {
                    statusText.text = "Status: offline"
                    errorText.text = "Error: " + (t.message ?: "websocket_failure")
                }
            }
        })
    }

    private fun disconnect(closeCode: Int = 1000, reason: String = "user_disconnect") {
        webSocket?.close(closeCode, reason)
        webSocket = null
        statusText.text = "Status: offline"
    }

    private fun handleServerMessage(text: String) {
        val message = try {
            JSONObject(text)
        } catch (error: Exception) {
            errorText.text = "Error: invalid server JSON"
            return
        }

        if (message.optString("type") == "hello") {
            errorText.text = "Error: none"
            return
        }

        if (message.optString("type") != "command") {
            return
        }

        val requestId = message.optString("request_id")
        val action = message.optString("action")
        val durationMs = if (message.has("duration_ms")) message.optInt("duration_ms") else 2000
        val level = if (message.has("level") && !message.isNull("level")) message.optInt("level") else null

        lastCommandText.text = "Last command: $message"

        if (durationMs !in 100..5000) {
            sendAck(requestId, action, false, null, "invalid_duration")
            return
        }

        if (action == "ping") {
            sendAck(requestId, action, true, null, null)
            return
        }

        runBleCommand(requestId, action, level, durationMs)
    }

    private fun runBleCommand(requestId: String, action: String, level: Int?, durationMs: Int) {
        val pairingId = pairingInput.text.toString().trim().ifEmpty { "5002" }

        try {
            when (action) {
                "set_suction" -> {
                    val uuid = BleProtocol.buildSuctionUuid(pairingId, requireNotNull(level) { "invalid_level" })
                    advertiseOne(uuid, durationMs) { error ->
                        sendAck(requestId, action, error == null, uuid, error)
                    }
                }

                "set_vibration" -> {
                    val uuid = BleProtocol.buildVibrationUuid(pairingId, requireNotNull(level) { "invalid_level" })
                    advertiseOne(uuid, durationMs) { error ->
                        sendAck(requestId, action, error == null, uuid, error)
                    }
                }

                "stop_suction" -> {
                    val uuid = BleProtocol.buildStopSuctionUuid(pairingId)
                    advertiseOne(uuid, durationMs) { error ->
                        sendAck(requestId, action, error == null, uuid, error)
                    }
                }

                "stop_vibration" -> {
                    val uuid = BleProtocol.buildStopVibrationUuid(pairingId)
                    advertiseOne(uuid, durationMs) { error ->
                        sendAck(requestId, action, error == null, uuid, error)
                    }
                }

                "stop_all" -> {
                    val suctionUuid = BleProtocol.buildStopSuctionUuid(pairingId)
                    val vibrationUuid = BleProtocol.buildStopVibrationUuid(pairingId)
                    advertiseOne(suctionUuid, durationMs) { firstError ->
                        if (firstError != null) {
                            sendAck(requestId, action, false, listOf(suctionUuid), firstError)
                        } else {
                            advertiseOne(vibrationUuid, durationMs) { secondError ->
                                sendAck(requestId, action, secondError == null, listOf(suctionUuid, vibrationUuid), secondError)
                            }
                        }
                    }
                }

                else -> sendAck(requestId, action, false, null, "unknown_action")
            }
        } catch (error: Exception) {
            sendAck(requestId, action, false, null, error.message ?: "command_failed")
        }
    }

    private fun advertiseOne(uuidText: String, durationMs: Int, done: (String?) -> Unit) {
        lastUuidText.text = "Last UUID: $uuidText"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED
        ) {
            done("missing_bluetooth_advertise_permission")
            return
        }

        val manager = getSystemService(BLUETOOTH_SERVICE) as BluetoothManager
        val advertiser = manager.adapter?.bluetoothLeAdvertiser
        if (advertiser == null) {
            done("ble_advertiser_unavailable")
            return
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(false)
            .setTimeout(0)
            .build()

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(BleProtocol.asUuid(uuidText)))
            .build()

        val callback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                lastAdvertiseText.text = "Last BLE advertise: started"
                mainHandler.postDelayed({
                    advertiser.stopAdvertising(this)
                    lastAdvertiseText.text = "Last BLE advertise: success for " + durationMs + "ms"
                    done(null)
                }, durationMs.toLong())
            }

            override fun onStartFailure(errorCode: Int) {
                val error = "advertise_failed_$errorCode"
                lastAdvertiseText.text = "Last BLE advertise: $error"
                done(error)
            }
        }

        advertiser.startAdvertising(settings, data, callback)
    }

    private fun sendAck(requestId: String, action: String, ok: Boolean, generatedUuid: Any?, error: String?) {
        val ack = JSONObject()
            .put("type", "ack")
            .put("request_id", requestId)
            .put("action", action)
            .put("ok", ok)
            .put("error", error ?: JSONObject.NULL)

        when (generatedUuid) {
            is String -> ack.put("generated_uuid", generatedUuid)
            is List<*> -> ack.put("generated_uuid", JSONArray(generatedUuid))
            null -> ack.put("generated_uuid", JSONObject.NULL)
        }

        webSocket?.send(ack.toString())
        errorText.text = "Error: " + (error ?: "none")
    }
}
