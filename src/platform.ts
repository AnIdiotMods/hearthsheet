// Everything that differs between running as the native app (Tauri: Windows, macOS, Linux,
// Android, iOS) and running in a browser: opening and saving files. The rest of the app only
// calls these functions, so it behaves the same on every platform.

export const isNative = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** "Windows", "macOS", "Linux", "Android", "iOS" or "Web". */
export function platformName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) return 'iOS';
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os x|macintosh/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Web';
}

export const isMobile = () => platformName() === 'Android' || platformName() === 'iOS';

/** Hand a file to the system share sheet (Save to Files, Drive, mail, …). False when unsupported or cancelled. */
async function shareFile(fileName: string, text: string, extension: string): Promise<boolean> {
  try {
    const file = new File([text], fileName, { type: extension === 'xml' ? 'application/xml' : 'text/plain' });
    if (!navigator.canShare?.({ files: [file] })) return false;
    await navigator.share({ files: [file], title: fileName });
    return true;
  } catch {
    return false;
  }
}

export interface PickedFile { name: string; data: Uint8Array }

const baseName = (p: string) => {
  const last = decodeURIComponent(p).split(/[\\/]/).pop() ?? p;
  // Android document URIs end in e.g. "primary:Download/My File.xml".
  return last.includes(':') ? last.slice(last.lastIndexOf(':') + 1).split('/').pop() ?? last : last;
};

/** Let the player pick files. `extensions` without dots, e.g. ["xml"]. */
export async function pickFiles(label: string, extensions: string[], multiple = true): Promise<PickedFile[]> {
  if (isNative()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    // Phone pickers filter by file type unreliably (XML files often show greyed out), so they are not
    // filtered there; the importers check the content anyway.
    const mobile = isMobile();
    const picked = await open({ multiple, directory: false, ...(mobile ? {} : { filters: [{ name: label, extensions }] }) });
    const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
    return Promise.all(paths.map(async (p) => ({ name: baseName(String(p)), data: await readFile(String(p)) })));
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.map((e) => `.${e}`).join(',');
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      input.remove();
      resolve(await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
    };
    input.addEventListener('cancel', () => { input.remove(); resolve([]); });
    input.click();
  });
}

export const decodeText = (data: Uint8Array) => new TextDecoder('utf-8').decode(data);

/**
 * Save text to a file the player chooses. Returns false when they cancel.
 * In a browser the file goes to the downloads folder.
 */
export async function saveTextFile(fileName: string, text: string, label = 'XML file', extension = 'xml'): Promise<boolean> {
  if (isNative()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      const path = await save({ defaultPath: fileName, ...(isMobile() ? {} : { filters: [{ name: label, extensions: [extension] }] }) });
      if (!path) return false;
      await writeTextFile(path, text);
      return true;
    } catch (e) {
      // Where the system has no save dialog (iOS), the share sheet offers "Save to Files".
      if (await shareFile(fileName, text, extension)) return true;
      throw e;
    }
  }
  if (isMobile() && await shareFile(fileName, text, extension)) return true;
  const url = URL.createObjectURL(new Blob([text], { type: extension === 'xml' ? 'application/xml' : 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
