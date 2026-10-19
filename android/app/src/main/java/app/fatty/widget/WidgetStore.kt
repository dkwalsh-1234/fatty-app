package app.fatty.widget

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.widgetDataStore by preferencesDataStore(name = "widget")

/**
 * The last summary the web app sent, shared by every placed widget (a widget added later shows it
 * straight away). [State.tick] changes whenever the widget should look at the clock again, such as
 * just after midnight, so a running Glance session recomposes even though the summary didn't change.
 */
class WidgetStore(context: Context) {
    private val store = context.applicationContext.widgetDataStore

    data class State(val summaryJson: String?, val tick: Long)

    val state: Flow<State> = store.data.map { State(it[SUMMARY], it[TICK] ?: 0L) }

    suspend fun current(): State = state.first()

    suspend fun saveSummary(json: String) = store.edit {
        it[SUMMARY] = json
        it[TICK] = System.currentTimeMillis()
    }

    suspend fun tick() = store.edit { it[TICK] = System.currentTimeMillis() }

    private companion object {
        val SUMMARY = stringPreferencesKey("summary")
        val TICK = longPreferencesKey("tick")
    }
}
