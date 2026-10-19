package app.fatty

import android.app.Application
import android.content.Context
import android.util.Log
import androidx.work.Configuration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class FattyApp : Application(), Configuration.Provider {
    /** Work that should finish even if the activity goes away first, like a widget update. */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // WorkManager is initialised on demand rather than at process start (see the manifest).
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setMinimumLoggingLevel(Log.INFO).build()

    companion object {
        fun scope(context: Context): CoroutineScope = (context.applicationContext as FattyApp).appScope
    }
}
