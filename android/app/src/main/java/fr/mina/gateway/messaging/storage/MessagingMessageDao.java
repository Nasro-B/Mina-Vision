package fr.mina.gateway.messaging.storage;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

import java.util.List;

@Dao
public interface MessagingMessageDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    long insert(EncryptedMessageEntity entity);

    @Query("SELECT * FROM encrypted_messages WHERE state = :state ORDER BY stored_at_ms LIMIT :limit")
    List<EncryptedMessageEntity> byState(String state, int limit);

    @Query("UPDATE encrypted_messages SET state = :state WHERE dedupe_index = :dedupeIndex")
    int updateState(String dedupeIndex, String state);

    @Query("UPDATE encrypted_messages SET state = 'ingested' WHERE state = 'received' AND dedupe_index IN (:messageIds)")
    int acknowledge(List<String> messageIds);

    @Query("SELECT * FROM encrypted_messages ORDER BY stored_at_ms")
    List<EncryptedMessageEntity> allForTest();
}
