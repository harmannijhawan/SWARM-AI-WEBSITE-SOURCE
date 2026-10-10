package com.swarm.ai.data.local

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import com.swarm.ai.model.Agent
import com.swarm.ai.model.AIModel
import com.swarm.ai.model.AppSettings
import com.swarm.ai.model.BuildHistory
import kotlinx.coroutines.flow.Flow

@Dao
interface SwarmDao {
    @Query("SELECT * FROM agents")
    fun getAllAgents(): Flow<List<Agent>>

    @Query("SELECT COUNT(*) FROM agents")
    suspend fun countAgents(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAgent(agent: Agent)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAgents(agents: List<Agent>)

    @Query("SELECT * FROM ai_models")
    fun getAllModels(): Flow<List<AIModel>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertModel(model: AIModel)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertModels(models: List<AIModel>)

    @Query("SELECT * FROM settings WHERE id = 1")
    fun getSettings(): Flow<AppSettings?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveSettings(settings: AppSettings)

    @Query("SELECT * FROM build_history ORDER BY timestamp DESC")
    fun getBuildHistory(): Flow<List<BuildHistory>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertBuildHistory(history: BuildHistory)
}

@Database(entities = [Agent::class, AIModel::class, AppSettings::class, BuildHistory::class], version = 1, exportSchema = false)
abstract class SwarmDatabase : RoomDatabase() {
    abstract fun swarmDao(): SwarmDao

    companion object {
        @Volatile
        private var INSTANCE: SwarmDatabase? = null

        fun getDatabase(context: Context): SwarmDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    SwarmDatabase::class.java,
                    "swarm_database"
                )
                .fallbackToDestructiveMigration()
                .build()
                .also { INSTANCE = it }
                instance
            }
        }
    }
}
