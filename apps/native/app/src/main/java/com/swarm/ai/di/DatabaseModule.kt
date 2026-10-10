package com.swarm.ai.di

import android.content.Context
import com.swarm.ai.data.local.SwarmDao
import com.swarm.ai.data.local.SwarmDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): SwarmDatabase =
        SwarmDatabase.getDatabase(context)

    @Provides
    fun provideSwarmDao(db: SwarmDatabase): SwarmDao = db.swarmDao()
}