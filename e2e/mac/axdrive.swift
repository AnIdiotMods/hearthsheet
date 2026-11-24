// Drives the macOS app through the accessibility layer (what VoiceOver uses), the way a person works it:
// presses buttons by their names, types into fields with the keyboard, picks from menus.
// Reads one JSON command per line on stdin and answers one JSON line on stdout.
//   {"cmd":"press","name":"Level up"}  {"cmd":"fill","name":"Name","text":"Thorin"}
//   {"cmd":"choose","name":"Race","option":"Dwarf (Hill)"}  {"cmd":"tick","name":"History"}
//   {"cmd":"seen","text":"..."}  {"cmd":"read","name":"Armor class"}  {"cmd":"keys","keys":["cmd+shift+g"]}
//   {"cmd":"type","text":"/path"}  {"cmd":"dump"}  {"cmd":"frontmost"}
import Cocoa
import ApplicationServices

let bundleId = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "org.hearthsheet.app"

struct Node {
  let el: AXUIElement
  let role: String, subrole: String, title: String, desc: String, value: String, placeholder: String
  let depth: Int
  let inDialog: Bool
  var names: [String] { [title, desc, role == "AXStaticText" ? value : "", placeholder].filter { !$0.isEmpty } }
}

func attr(_ e: AXUIElement, _ n: String) -> AnyObject? {
  var v: AnyObject?
  return AXUIElementCopyAttributeValue(e, n as CFString, &v) == .success ? v : nil
}
func text(_ e: AXUIElement, _ n: String) -> String {
  let v = attr(e, n)
  if let s = v as? String { return s }
  if let x = v as? NSNumber { return x.stringValue }
  return ""
}
func kids(_ e: AXUIElement) -> [AXUIElement] { (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func frame(_ e: AXUIElement) -> CGRect {
  var p = CGPoint.zero, s = CGSize.zero
  if let v = attr(e, kAXPositionAttribute) { AXValueGetValue(v as! AXValue, .cgPoint, &p) }
  if let v = attr(e, kAXSizeAttribute) { AXValueGetValue(v as! AXValue, .cgSize, &s) }
  return CGRect(origin: p, size: s)
}
func clean(_ s: String) -> String { s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces) }

func app() -> (NSRunningApplication, AXUIElement)? {
  guard let a = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first else { return nil }
  return (a, AXUIElementCreateApplication(a.processIdentifier))
}

/** Every element in the app's windows (and open menus), in reading order. */
func nodes() -> [Node] {
  guard let (_, root) = app() else { return [] }
  var out: [Node] = []
  func walk(_ e: AXUIElement, _ d: Int, _ dlg: Bool) {
    if d > 80 || out.count > 6000 { return }
    let role = text(e, kAXRoleAttribute), sub = text(e, kAXSubroleAttribute)
    let isDlg = dlg || sub == "AXApplicationDialog" || sub == "AXApplicationAlertDialog" || role == "AXSheet"
    out.append(Node(el: e, role: role, subrole: sub, title: clean(text(e, kAXTitleAttribute)), desc: clean(text(e, kAXDescriptionAttribute)),
                    value: clean(text(e, kAXValueAttribute)), placeholder: clean(text(e, "AXPlaceholderValue")), depth: d, inDialog: isDlg))
    for k in kids(e) { walk(k, d + 1, isDlg) }
  }
  for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] { walk(w, 0, false) }
  // Open pop-up menus hang off the app element.
  for k in kids(root) where text(k, kAXRoleAttribute) == "AXMenu" { walk(k, 0, true) }
  return out
}

/** Only what a person can reach: inside the open in-app window when there is one. */
func reachable(_ all: [Node]) -> [Node] {
  let dlg = all.filter { $0.inDialog }
  return dlg.isEmpty ? all : dlg
}

func activate() {
  guard let (a, _) = app() else { return }
  a.activate(options: [.activateIgnoringOtherApps])
  usleep(150_000)
}

func click(_ e: AXUIElement) {
  _ = AXUIElementPerformAction(e, "AXScrollToVisible" as CFString)
  usleep(120_000)
  let f = frame(e)
  let p = CGPoint(x: f.midX, y: f.midY)
  activate()
  let src = CGEventSource(stateID: .hidSystemState)
  for t in [CGEventType.leftMouseDown, .leftMouseUp] {
    CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(40_000)
  }
}

func press(_ n: Node) {
  if AXUIElementPerformAction(n.el, kAXPressAction as CFString) != .success { click(n.el) }
}

let keyCodes: [String: CGKeyCode] = ["a": 0, "g": 5, "return": 36, "tab": 48, "delete": 51, "escape": 53, "down": 125, "up": 126]
func key(_ combo: String) {
  let parts = combo.lowercased().split(separator: "+").map(String.init)
  var flags = CGEventFlags()
  for p in parts.dropLast() {
    if p == "cmd" { flags.insert(.maskCommand) }
    if p == "shift" { flags.insert(.maskShift) }
    if p == "alt" { flags.insert(.maskAlternate) }
    if p == "ctrl" { flags.insert(.maskControl) }
  }
  guard let code = keyCodes[parts.last ?? ""] else { return }
  let src = CGEventSource(stateID: .hidSystemState)
  for down in [true, false] {
    let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)
    e?.flags = flags
    e?.post(tap: .cghidEventTap)
    usleep(30_000)
  }
}
func typeText(_ s: String) {
  let src = CGEventSource(stateID: .hidSystemState)
  for ch in s.utf16 {
    for down in [true, false] {
      let e = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: down)
      var c = ch
      e?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &c)
      e?.post(tap: .cghidEventTap)
    }
    usleep(12_000)
  }
}

func find(_ name: String, roles: Set<String>) -> Node? {
  let all = reachable(nodes())
  return all.first { roles.contains($0.role) && $0.names.contains(name) }
}

let pressRoles: Set<String> = ["AXButton", "AXRadioButton", "AXCheckBox", "AXLink", "AXTab", "AXMenuItem", "AXPopUpButton", "AXDisclosureTriangle", "AXCell", "AXRow"]
let fieldRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]

func handle(_ c: [String: Any]) -> [String: Any] {
  let cmd = c["cmd"] as? String ?? ""
  let name = c["name"] as? String ?? ""
  switch cmd {
  case "frontmost":
    activate(); return ["ok": app() != nil]
  case "press":
    if let n = find(name, roles: pressRoles) { press(n); return ["ok": true, "role": n.role] }
    // Text inside something pressable, such as a list entry or a card's heading: click it.
    if let n = reachable(nodes()).first(where: { $0.role == "AXStaticText" && $0.value == name || $0.role == "AXHeading" && $0.names.contains(name) }) {
      click(n.el); return ["ok": true, "role": n.role, "clicked": true]
    }
    return ["ok": false, "error": "nothing named \(name)"]
  case "fill":
    guard let n = find(name, roles: fieldRoles) else { return ["ok": false, "error": "no field named \(name)"] }
    activate()
    AXUIElementSetAttributeValue(n.el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    usleep(150_000)
    if text(n.el, kAXFocusedAttribute) != "1" { click(n.el) }
    // With "focusOnly", the caller types through System Events (keystrokes posted by this helper can
    // be dropped where it lacks the separate permission to post keyboard events).
    if c["focusOnly"] as? Bool == true { return ["ok": true] }
    key("cmd+a"); key("delete")
    typeText(c["text"] as? String ?? "")
    return ["ok": true]
  case "choose":
    guard let n = find(name, roles: ["AXPopUpButton", "AXComboBox"]) else { return ["ok": false, "error": "no dropdown named \(name)"] }
    let option = c["option"] as? String ?? ""
    press(n)
    for _ in 0..<40 {
      usleep(150_000)
      let items = nodes().filter { $0.role == "AXMenuItem" }
      if let it = items.first(where: { $0.title == option }) ?? items.first(where: { $0.title.hasPrefix(option + " [") }) {
        press(it); usleep(200_000)
        return ["ok": true, "now": text(n.el, kAXValueAttribute)]
      }
    }
    key("escape")
    return ["ok": false, "error": "no entry \(option) in \(name)"]
  case "tick":
    guard let n = find(name, roles: ["AXCheckBox", "AXRadioButton"]) else { return ["ok": false, "error": "no checkbox named \(name)"] }
    if text(n.el, kAXValueAttribute) != "1" { press(n) }
    return ["ok": true]
  case "seen":
    let t = c["text"] as? String ?? ""
    let hit = nodes().contains { $0.title.contains(t) || $0.desc.contains(t) || $0.value.contains(t) }
    return ["ok": hit]
  case "read":
    // Read a number off the sheet as a person would: the text that follows its label.
    let all = nodes()
    func after(_ label: String) -> String? {
      guard let i = all.firstIndex(where: { $0.role == "AXStaticText" && $0.value.caseInsensitiveCompare(label) == .orderedSame }) else { return nil }
      return all[(i + 1)...].first(where: { $0.role == "AXStaticText" && !$0.value.isEmpty })?.value
    }
    switch name {
    case "Hit points":
      guard let f = all.first(where: { $0.names.contains("Current hit points") }),
            let i = all.firstIndex(where: { CFEqual($0.el, f.el) }),
            let max = all[(i + 1)...].first(where: { $0.role == "AXStaticText" && Int($0.value) != nil }) else { return ["ok": false] }
      return ["ok": true, "value": "\(f.value) / \(max.value)"]
    case "Spell save DC":
      return ["ok": true, "value": after("Save DC") ?? ""]
    default:
      if name.hasSuffix("-level slots used") {
        let prefix = name.replacingOccurrences(of: "-level slots used", with: "-level slot ")
        let boxes = all.filter { $0.role == "AXCheckBox" && $0.names.contains { $0.hasPrefix(prefix) } }
        return ["ok": true, "value": "\(boxes.filter { $0.value == "1" }.count) of \(boxes.count)"]
      }
      // A stat shown inside a button can come through as one name, such as "Armor Class 18".
      let prefixed = all.lazy.flatMap { [$0.title, $0.desc] }.first { $0.lowercased().hasPrefix(name.lowercased() + " ") }
      return ["ok": true, "value": after(name) ?? prefixed.map { String($0.dropFirst(name.count + 1)) } ?? ""]
    }
  case "keys":
    activate()
    for k in c["keys"] as? [String] ?? [] { key(k); usleep(250_000) }
    return ["ok": true]
  case "type":
    activate(); typeText(c["text"] as? String ?? ""); return ["ok": true]
  case "dump":
    let lines = nodes().map { String(repeating: " ", count: $0.depth) + "\($0.role)\($0.subrole.isEmpty ? "" : "/" + $0.subrole) title=\($0.title) desc=\($0.desc) value=\($0.value.prefix(60))\($0.inDialog ? " [dialog]" : "")" }
    return ["ok": true, "tree": lines.joined(separator: "\n")]
  default:
    return ["ok": false, "error": "unknown command \(cmd)"]
  }
}

setbuf(stdout, nil)
print(#"{"ready":true,"trusted":\#(AXIsProcessTrusted())}"#)
while let line = readLine() {
  guard let data = line.data(using: .utf8), let c = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    print(#"{"ok":false,"error":"bad command"}"#); continue
  }
  let r = handle(c)
  let out = (try? JSONSerialization.data(withJSONObject: r)) ?? Data("{}".utf8)
  print(String(data: out, encoding: .utf8) ?? "{}")
}
