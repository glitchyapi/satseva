package org.satseva.app;

import org.json.JSONArray;
import org.json.JSONObject;

/** Defensive schema gate. Nothing reaches the WebView that is not shaped correctly. */
public final class StateValidator {
    private StateValidator() {}

    public static JSONObject parse(String json) throws Exception {
        if (json == null || json.length() > 8 * 1024 * 1024) throw new Exception("Journal too large");
        JSONObject o = new JSONObject(json);
        JSONArray entries = o.optJSONArray("entries");
        if (entries != null) {
            if (entries.length() > 20000) throw new Exception("Too many entries");
            for (int i = 0; i < entries.length(); i++) {
                JSONObject e = entries.optJSONObject(i);
                if (e == null) throw new Exception("Malformed entry");
                String date = e.optString("date", "");
                if (!date.matches("\\d{4}-\\d{2}-\\d{2}")) throw new Exception("Malformed entry date");
                if (e.optString("title", "").length() > 200) throw new Exception("Entry title too long");
                if (e.optString("note", "").length() > 4000) throw new Exception("Entry note too long");
            }
        }
        return o;
    }
}
