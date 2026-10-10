package com.swarm.ai.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val PrimaryBlue = Color(0xFF2463FF)
val PrimaryDarkBlue = Color(0xFF0060DF)
val SecondaryOrange = Color(0xFFFF9F0A)
val BackgroundGray = Color(0xFFF8F9FE)
val SurfaceWhite = Color(0xFFFFFFFF)
val OnPrimaryWhite = Color(0xFFFFFFFF)
val OnSurfaceDark = Color(0xFF101522)
val DividerGray = Color(0xFFC6C6C8)
val SuccessGreen = Color(0xFF34C759)
val ErrorRed = Color(0xFFFF3B30)

private val LightColorScheme = lightColorScheme(
    primary = PrimaryBlue,
    onPrimary = OnPrimaryWhite,
    secondary = SecondaryOrange,
    background = BackgroundGray,
    surface = SurfaceWhite,
    onSurface = OnSurfaceDark,
    onBackground = OnSurfaceDark,
    surfaceVariant = Color(0xFFF0F3FB),
    onSurfaceVariant = Color(0xFF66718A),
    primaryContainer = Color(0xFFE6EDFF),
    onPrimaryContainer = PrimaryBlue,
    outline = Color(0xFFDCE2F0),
    outlineVariant = Color(0xFFE9EDF6),
    error = ErrorRed
)

@Composable
fun SwarmAITheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = LightColorScheme,
        shapes = androidx.compose.material3.Shapes(
            small = androidx.compose.foundation.shape.RoundedCornerShape(12),
            medium = androidx.compose.foundation.shape.RoundedCornerShape(20),
            large = androidx.compose.foundation.shape.RoundedCornerShape(28)
        ),
        content = content
    )
}
