package fr.mina.gateway

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fr.mina.gateway.feature.chat.MinaChatTheme

/** Guide intégré de l'application téléphone : ce que Mina fait, comment l'appairer et la sécurité. */
class AideActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent { MinaChatTheme { AideScreen() } }
    }
}

private data class GuideSection(val title: String, val body: String)

private val GUIDE = listOf(
    GuideSection(
        "Qu'est-ce que Mina ?",
        "Mina est ton assistante. Ce téléphone lui parle : tu écris ou tu dictes, ta demande part " +
            "vers ton PC (chiffrée de bout en bout), Mina répond ici. Personne d'autre ne peut lire vos échanges.",
    ),
    GuideSection(
        "Appairer le PC (une seule fois)",
        "Sur le PC, ouvre Mina Vision → onglet Système → Appairage : une adresse et un code à 6 chiffres " +
            "s'affichent. Dans l'app, ouvre la conversation, saisis l'adresse, le port et le code. Le code est " +
            "valable 5 minutes, une seule fois. Mina ne parle qu'à un PC appairé.",
    ),
    GuideSection(
        "Conversation",
        "Écris ou appuie sur Micro pour dicter. Si le PC est éteint, ton message n'est pas perdu : il part " +
            "dès que le PC revient. L'état sous chaque message est honnête (« en file », « reçu par le PC », " +
            "« Mina répond », « répondu »).",
    ),
    GuideSection(
        "Photos et notes vocales",
        "Le bouton « Photo » envoie une image : elle est redimensionnée et ses métadonnées de position " +
            "(GPS) retirées avant l'envoi, puis chiffrée comme un message. Mina la regarde côté PC et te dit " +
            "ce qu'elle voit. Le bouton « Vocale » enregistre une note audio courte (appuie pour démarrer, " +
            "« ● Fin » pour l'envoyer) ; elle part chiffrée et Mina la garde (elle la transcrira si la " +
            "transcription hors-ligne est activée sur le PC). Tout part par l'outbox : rien n'est perdu si le " +
            "PC est éteint. Si le PC n'est pas à jour, l'app te le dit au lieu d'envoyer dans le vide.",
    ),
    GuideSection(
        "Verrou biométrique (facultatif)",
        "Sur l'accueil, active « Verrou biométrique » pour exiger ton empreinte ou ton visage avant " +
            "d'afficher la conversation. Si aucune empreinte n'est enrôlée sur le téléphone, le verrou reste " +
            "inactif — tu n'es jamais enfermé dehors.",
    ),
    GuideSection(
        "Passerelle SMS & Telegram (facultatif)",
        "Sur l'accueil, la carte Passerelle permet à Mina de recevoir tes SMS et de te répondre via " +
            "Telegram quand tu es loin du PC. Le chemin SMS marche SANS internet : ton SMS arrive par le " +
            "réseau cellulaire, ce téléphone le relaie au PC en réseau local, et la réponse repart en SMS. " +
            "Un seul téléphone doit porter le token Telegram à la fois " +
            "(deux téléphones avec le même token entrent en conflit). Le bouton « Retirer la passerelle » " +
            "efface le numéro et le token Telegram de CE téléphone et arrête le service — utile pour la " +
            "déplacer proprement vers un autre téléphone, sans toucher à ta conversation chiffrée.",
    ),
    GuideSection(
        "Sécurité",
        "Tout ce qui est sensible (identité, token, clés de conversation) reste chiffré sur ce téléphone " +
            "(Android Keystore + base chiffrée). Rien ne le quitte en clair. Tu peux désappairer à tout " +
            "moment depuis la conversation : Mina change alors de clé et cet appareil ne lit plus la suite.",
    ),
    GuideSection(
        "Réclamations et service client",
        "mina.vision.ai@gmail.com",
    ),
)

@Composable
private fun AideScreen() {
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Guide Mina", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            for (section in GUIDE) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(section.title, style = MaterialTheme.typography.titleLarge)
                        Text(
                            section.body,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}
