package fr.mina.gateway.messaging.storage;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

@Database(
        entities = {EncryptedSecretEntity.class, EncryptedMessageEntity.class},
        version = 1,
        exportSchema = true
)
public abstract class MessagingDatabase extends RoomDatabase {
    private static volatile MessagingDatabase instance;

    public abstract MessagingSecretDao secretDao();
    public abstract MessagingMessageDao messageDao();

    public static MessagingDatabase open(Context context) {
        MessagingDatabase current = instance;
        if (current != null) return current;
        synchronized (MessagingDatabase.class) {
            current = instance;
            if (current == null) {
                current = Room.databaseBuilder(
                        context.getApplicationContext(),
                        MessagingDatabase.class,
                        "mina-messaging.db"
                ).build();
                instance = current;
            }
            return current;
        }
    }
}
