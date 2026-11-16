package app.hamesh.reader

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  /**
   * The app renders edge-to-edge, but the Android WebView never maps system
   * bars to CSS env(safe-area-inset-*): in-app chrome would draw under the
   * status bar. Forward the bar insets into the page as CSS custom properties
   * (--android-safe-*) that styles.css folds into its safe-area vars, so
   * every surface clears the bars while the WebView stays full-bleed and the
   * translucent bar scrims blend with the canvas. The WebView attaches
   * asynchronously, so pushes also retry shortly after launch.
   */
  private var latestBars: Insets? = null

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        findWebView(view.getChildAt(index))?.let { return it }
      }
    }
    return null
  }

  private fun pushInsets() {
    val bars = latestBars ?: return
    val script =
      "document.documentElement.style.setProperty('--android-safe-top','" + bars.top + "px');" +
        "document.documentElement.style.setProperty('--android-safe-bottom','" + bars.bottom + "px');" +
        "document.documentElement.style.setProperty('--android-safe-left','" + bars.left + "px');" +
        "document.documentElement.style.setProperty('--android-safe-right','" + bars.right + "px');"
    findWebView(findViewById(android.R.id.content))?.evaluateJavascript(script, null)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { _, insets ->
      latestBars =
        insets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
        )
      pushInsets()
      content.postDelayed({ pushInsets() }, 600)
      content.postDelayed({ pushInsets() }, 1800)
      insets
    }
  }
}
