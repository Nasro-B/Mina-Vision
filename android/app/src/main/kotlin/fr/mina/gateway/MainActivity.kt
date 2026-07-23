package fr.mina.gateway

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Build
import android.text.InputType
import android.text.method.DigitsKeyListener
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import fr.mina.gateway.camera.CameraStreamService
import fr.mina.gateway.messaging.MessagingExecutors
import fr.mina.gateway.messaging.MinaGatewayService
import fr.mina.gateway.messaging.TelegramGateway
import fr.mina.gateway.messaging.storage.AndroidKeystoreFieldCipher
import fr.mina.gateway.messaging.storage.EncryptedOwnerIdentityStore
import fr.mina.gateway.messaging.storage.MessagingDatabase
import fr.mina.gateway.messaging.storage.RoomMessagingSecretStore
import fr.mina.gateway.transport.DeviceIdentityStore
import org.json.JSONObject

class MainActivity : Activity() {
    private lateinit var status: TextView
    private var pendingCameraLens = "front"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val identity = DeviceIdentityStore(this).createProof("local-pairing-v1")
        writeIdentityProof(identity.deviceId, identity.publicKeySpkiBase64, identity.challenge, identity.signatureBase64)
        setContentView(buildProvisioningScreen(identity.deviceId))
        if (!handleCameraIntent(intent)) requestMessagingPermissions()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleCameraIntent(intent)
    }

    private fun buildProvisioningScreen(deviceId: String): ScrollView {
        val padding = (20 * resources.displayMetrics.density).toInt()
        val phone = input("Numéro propriétaire E.164, ex. +336…")
        val telegramIds = input("IDs Telegram numériques, séparés par des virgules").apply {
            keyListener = DigitsKeyListener.getInstance("0123456789,")
        }
        val token = input("Token BotFather").apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        status = TextView(this).apply {
            text = "Chargement de la configuration enregistrée…"
            textSize = 16f
            setPadding(0, padding, 0, padding)
        }
        val save = Button(this).apply {
            text = "Enregistrer localement et chiffrer"
            contentDescription = "Enregistrer la configuration propriétaire Mina Vision"
            setOnClickListener { provision(phone, telegramIds, token) }
        }
        // Entrée principale : la conversation. La configuration passerelle reste en dessous,
        // c'est un réglage — pas ce qu'on vient faire tous les jours.
        val openChat = Button(this).apply {
            text = "Ouvrir la conversation avec Mina"
            contentDescription = "Ouvrir la conversation chiffrée avec Mina"
            setOnClickListener { startActivity(Intent(this@MainActivity, ChatActivity::class.java)) }
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(padding, padding, padding, padding)
            addView(TextView(context).apply {
                text = "Mina Vision"
                textSize = 24f
                gravity = Gravity.CENTER
            })
            addView(openChat)
            addView(TextView(context).apply {
                text = "Appareil appairé : $deviceId\nLes secrets restent chiffrés dans Android Keystore + Room."
                textSize = 15f
                gravity = Gravity.CENTER
                setPadding(0, padding, 0, padding)
            })
            addView(phone)
            addView(telegramIds)
            addView(token)
            addView(save)
            addView(status)
        }
        loadSavedProvisioningState(phone, telegramIds)
        return ScrollView(this).apply { addView(content) }
    }

    // Token never re-read/pre-filled (write-only, same principle as the recovery phrase) — only
    // phone/Telegram IDs are safe to show back, and the status line confirms token presence without
    // exposing it. Without this, closing and reopening the app always looked like nothing was saved.
    private fun loadSavedProvisioningState(phone: EditText, telegramIds: EditText) {
        MessagingExecutors.io.execute {
            val loaded = runCatching {
                val database = MessagingDatabase.open(this)
                val secrets = RoomMessagingSecretStore(database.secretDao(), AndroidKeystoreFieldCipher())
                val identity = EncryptedOwnerIdentityStore(secrets).load()
                Triple(identity, secrets.has(TelegramGateway.BOT_TOKEN_SECRET_NAME), smsPermissionStatus() == "autorisé")
            }.getOrNull()
            runOnUiThread {
                val (identity, hasToken, smsGranted) = loaded ?: Triple(null, false, smsPermissionStatus() == "autorisé")
                if (identity != null) {
                    phone.setText(identity.phoneE164)
                    telegramIds.setText(identity.telegramUserIds.sorted().joinToString(","))
                }
                status.text = provisioningStatusText(
                    ProvisioningState(
                        smsPermissionGranted = smsGranted,
                        hasOwnerIdentity = identity != null,
                        hasTelegramToken = hasToken,
                    ),
                )
            }
        }
    }

    private fun input(hintText: String) = EditText(this).apply {
        hint = hintText
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
    }

    private fun provision(phone: EditText, telegramIds: EditText, tokenInput: EditText) {
        val phoneValue = phone.text.toString().trim()
        val idValues = telegramIds.text.toString().split(',').mapNotNull { it.trim().toLongOrNull() }.toSet()
        val token = tokenInput.text.toString().toCharArray()
        tokenInput.text.clear()
        status.text = "Validation et chiffrement…"
        MessagingExecutors.io.execute {
            val result = runCatching {
                val database = MessagingDatabase.open(this)
                val secrets = RoomMessagingSecretStore(database.secretDao(), AndroidKeystoreFieldCipher())
                val identities = EncryptedOwnerIdentityStore(secrets)
                identities.save(phoneValue, idValues, locallyConfirmed = true)
                if (shouldReplaceTelegramToken(token.size, secrets.has(TelegramGateway.BOT_TOKEN_SECRET_NAME))) {
                    TelegramGateway(requireNotNull(identities.load()), secrets)
                        .provisionToken(token, locallyConfirmed = true)
                }
            }
            token.fill('\u0000')
            runOnUiThread {
                status.text = result.fold(
                    onSuccess = {
                        restartGatewayService()
                        provisioningStatusText(
                            ProvisioningState(
                                smsPermissionGranted = smsPermissionStatus() == "autorisé",
                                hasOwnerIdentity = true,
                                hasTelegramToken = true,
                            ),
                        )
                    },
                    onFailure = { "Configuration refusée : ${it.message ?: "valeur_invalide"}" },
                )
            }
        }
    }

    private fun requestMessagingPermissions() {
        val requested = buildList {
            add(Manifest.permission.RECEIVE_SMS)
            add(Manifest.permission.SEND_SMS)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        val missing = requested
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), SMS_PERMISSION_REQUEST)
        else startGatewayService()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == SMS_PERMISSION_REQUEST && grantResults.isNotEmpty() &&
            grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        ) startGatewayService()
        if (requestCode == CAMERA_PERMISSION_REQUEST && grantResults.singleOrNull() == PackageManager.PERMISSION_GRANTED) {
            startCameraStream(pendingCameraLens)
        }
    }

    private fun handleCameraIntent(value: Intent?): Boolean = when (value?.action) {
        CameraStreamService.ACTION_START -> {
            pendingCameraLens = if (value.getStringExtra(CameraStreamService.EXTRA_LENS) == "back") "back" else "front"
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                startCameraStream(pendingCameraLens)
            } else {
                requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST)
            }
            true
        }
        CameraStreamService.ACTION_STOP -> {
            stopService(Intent(this, CameraStreamService::class.java))
            true
        }
        else -> false
    }

    private fun startCameraStream(lens: String) {
        startForegroundService(Intent(this, CameraStreamService::class.java).apply {
            action = CameraStreamService.ACTION_START
            putExtra(CameraStreamService.EXTRA_LENS, lens)
        })
    }

    private fun startGatewayService() {
        startForegroundService(Intent(this, MinaGatewayService::class.java))
    }

    private fun restartGatewayService() {
        stopService(Intent(this, MinaGatewayService::class.java))
        startGatewayService()
    }

    private fun smsPermissionStatus(): String =
        if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
        ) "autorisé" else "permission requise"

    private fun writeIdentityProof(deviceId: String, publicKey: String, challenge: String, signature: String) {
        openFileOutput("device-identity.json", MODE_PRIVATE).bufferedWriter().use { writer ->
            writer.write(JSONObject().apply {
                put("deviceId", deviceId)
                put("publicKeySpkiBase64", publicKey)
                put("challenge", challenge)
                put("signatureBase64", signature)
            }.toString())
        }
    }

    private companion object {
        const val SMS_PERMISSION_REQUEST = 201
        const val CAMERA_PERMISSION_REQUEST = 202
    }
}
