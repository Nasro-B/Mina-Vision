package fr.mina.gateway.messaging.storage;

import androidx.annotation.NonNull;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "encrypted_messages")
public final class EncryptedMessageEntity {
    @PrimaryKey
    @NonNull
    @ColumnInfo(name = "dedupe_index")
    public final String dedupeIndex;

    @NonNull
    public final String channel;

    @NonNull
    public final String direction;

    @NonNull
    @ColumnInfo(name = "sender_ciphertext")
    public final String senderCiphertext;

    @NonNull
    @ColumnInfo(name = "body_ciphertext")
    public final String bodyCiphertext;

    @ColumnInfo(name = "source_timestamp_ms")
    public final long sourceTimestampMs;

    @ColumnInfo(name = "stored_at_ms")
    public final long storedAtMs;

    @NonNull
    public final String state;

    public EncryptedMessageEntity(
            @NonNull String dedupeIndex,
            @NonNull String channel,
            @NonNull String direction,
            @NonNull String senderCiphertext,
            @NonNull String bodyCiphertext,
            long sourceTimestampMs,
            long storedAtMs,
            @NonNull String state
    ) {
        this.dedupeIndex = dedupeIndex;
        this.channel = channel;
        this.direction = direction;
        this.senderCiphertext = senderCiphertext;
        this.bodyCiphertext = bodyCiphertext;
        this.sourceTimestampMs = sourceTimestampMs;
        this.storedAtMs = storedAtMs;
        this.state = state;
    }
}
