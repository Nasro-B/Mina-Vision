package fr.mina.gateway.messaging.storage;

import androidx.annotation.NonNull;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "encrypted_messaging_secrets")
public final class EncryptedSecretEntity {
    @PrimaryKey
    @NonNull
    @ColumnInfo(name = "name_index")
    public final String nameIndex;

    @NonNull
    @ColumnInfo(name = "name_ciphertext")
    public final String nameCiphertext;

    @NonNull
    @ColumnInfo(name = "value_ciphertext")
    public final String valueCiphertext;

    @ColumnInfo(name = "updated_at_ms")
    public final long updatedAtMs;

    public EncryptedSecretEntity(
            @NonNull String nameIndex,
            @NonNull String nameCiphertext,
            @NonNull String valueCiphertext,
            long updatedAtMs
    ) {
        this.nameIndex = nameIndex;
        this.nameCiphertext = nameCiphertext;
        this.valueCiphertext = valueCiphertext;
        this.updatedAtMs = updatedAtMs;
    }
}
