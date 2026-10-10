package com.swarm.ai.data.repository

import com.swarm.ai.data.model.UserPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsRepository @Inject constructor() {
    private val _preferences = MutableStateFlow(UserPreferences())
    val preferences: Flow<UserPreferences> = _preferences.asStateFlow()

    suspend fun updatePreferences(newPrefs: UserPreferences) {
        _preferences.value = newPrefs
    }
}
