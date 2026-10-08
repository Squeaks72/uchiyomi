// Full reload: rescan the pack (clears the registry) then re-add the always-on built-ins, the user's config
// sites, and the enabled Suwayomi extension sources. reloadSources() clears EVERYTHING, so all three must be
// re-registered after it.
//
// Async because the Suwayomi sources have to be fetched from that server; it fails soft, so a reload still
// succeeds (and still re-registers everything else) when the extension server is down.
import { reloadSources } from './loader';
import { loadBuiltins } from './builtins';
import { loadCustomSites } from './customSites';
import { loadSuwayomiSources, scheduleSuwayomiRetry } from './suwayomi/register';

export async function reloadAll(): Promise<{ loaded: number; files: number; suwayomi: number }> {
  let r = { loaded: 0, files: 0 };
  let swapped = false;
  // The engine is asked first and the registry swapped in one synchronous step after (register.ts load): clearing it
  // before the question left every extension series reading as not installed for as long as the engine took to answer.
  const sw = await loadSuwayomiSources(undefined, {
    beforeRegister: () => {
      swapped = true;
      r = reloadSources(); // clears registry + rescans SOURCES_DIR (pack)
      loadBuiltins();
      loadCustomSites();
    },
  }).catch(() => {
    // The load threw before it reached the swap (the database): the reload still happens, as it always did.
    if (!swapped) {
      r = reloadSources();
      loadBuiltins();
      loadCustomSites();
    }
    return null;
  });
  // ⚠️ The registry was just cleared, so an engine that is down right now takes every extension source with
  // it -- and before v0.49.0 nothing registered them again when it came back: a reload during an outage lost
  // them until someone reloaded by hand. The same retry the boot starts brings them back (#72); it is one loop,
  // so a reload while it already runs changes nothing.
  if (sw?.configured && !sw.reachable) scheduleSuwayomiRetry();
  return { ...r, suwayomi: sw?.registered ?? 0 };
}
