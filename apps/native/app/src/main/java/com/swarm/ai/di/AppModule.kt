package com.swarm.ai.di

import android.content.Context
import com.swarm.ai.inference.TFLiteHelper
import com.swarm.ai.data.repository.ModelRepository
import com.swarm.ai.data.repository.SettingsRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideTFLiteHelper(
        @ApplicationContext context: Context
    ): TFLiteHelper {
        return TFLiteHelper(context)
    }

    @Provides
    @Singleton
    fun provideModelRepository(
        tfLiteHelper: TFLiteHelper
    ): ModelRepository {
        return ModelRepository(tfLiteHelper)
    }

    @Provides
    @Singleton
    fun provideSettingsRepository(): SettingsRepository {
        return SettingsRepository()
    }
}
