package fr.mina.gateway.messaging.storage;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

import java.util.List;

@Dao
public interface MessagingSecretDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsert(EncryptedSecretEntity entity);

    @Query("SELECT * FROM encrypted_messaging_secrets WHERE name_index = :nameIndex LIMIT 1")
    EncryptedSecretEntity find(String nameIndex);

    @Query("SELECT COUNT(*) FROM encrypted_messaging_secrets WHERE name_index = :nameIndex")
    int count(String nameIndex);

    @Query("DELETE FROM encrypted_messaging_secrets WHERE name_index = :nameIndex")
    void delete(String nameIndex);

    @Query("SELECT * FROM encrypted_messaging_secrets ORDER BY name_index")
    List<EncryptedSecretEntity> allForTest();
}
