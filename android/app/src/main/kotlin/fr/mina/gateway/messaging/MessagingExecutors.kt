package fr.mina.gateway.messaging

import java.util.concurrent.Executors

object MessagingExecutors {
    val io = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "mina-messaging-io").apply { isDaemon = true }
    }
}
