# Flutter App Plan

## Goal

Replace the current iOS Shortcut/browser-script workflow with one cross-platform Flutter app for iOS and Android. A user should be able to configure multiple children once, create a launcher entry for each child where the platform allows it, and complete pickup or dropoff from a child-specific screen with one additional action.

The existing implementation is preserved in [`experiments/browser-script`](../experiments/browser-script) as a reference for the current DOM flow and request sequence.

## User experience

### Configuration

The app's setup flow should collect:

- Transparent Classroom dropoff URL.
- Parent PIN.
- Child display name or matching name.
- Signature.

Each child is a separate saved profile. The PIN and signature may be shared by several profiles, but the data model should not assume that they are. The setup screen should support creating, editing, deleting, and testing profiles.

The signature editor should use a Flutter canvas and persist a PNG representation suitable for the web signature pad. It should provide clear, undo/reset, and save controls.

### Child launcher

When a child-specific launcher is opened, the app should route directly to:

- The child's name.
- A notes field.
- `Pickup` and `Dropoff` buttons.

The selected child must be identified by an opaque profile ID, not by putting the PIN or signature in a URL or launcher payload. The app loads the profile from secure local storage after resolving that ID.

### Submission

As soon as the child action page opens, the app should prepare the webview without
requiring the user to choose a mode:

1. Validate that the profile has a URL, PIN, child name, and signature.
2. Open or reuse the webview session.
3. Navigate to the configured dropoff URL.
4. Enter the PIN and submit the sign-in form.
5. Select the configured child.

The app should then keep the webview at the child's mode-selection screen while
the user reviews the notes and chooses an action. Pressing `Pickup` or `Dropoff`
continues the already prepared flow:

6. Select the requested mode.
7. If notes were supplied, select `Add Note` and fill the resulting note field.
8. Select `Sign`.
9. Replay the saved signature on the signature canvas.
10. Select `Done`.
11. Wait for and report the site's success or error state.

The automation should follow the note UI path whenever the user supplied
non-empty notes, even if the current site does not include that text in the
event request. The app is responsible for reproducing the visible web flow;
it should not depend on a particular server-side representation of the note.

The UI should show progress for each state and provide a retry action. It should never report success merely because a click was dispatched; success requires the confirmation state or a successful event response.

## Proposed Flutter structure

```text
lib/
  main.dart
  app.dart
  models/
    child_profile.dart
    submission_request.dart
    submission_status.dart
  screens/
    profile_list_screen.dart
    profile_editor_screen.dart
    child_action_screen.dart
    submission_progress_screen.dart
    signature_editor.dart
  services/
    profile_store.dart
    launcher_service.dart
    submission_controller.dart
    webview_automation.dart
  web/
    automation_bootstrap.js
    automation_state_machine.js
    selectors.js
  platform/
    platform_shortcuts.dart
```

Use `flutter_inappwebview` rather than only the basic webview plugin. It provides the controls needed here: early user scripts, navigation callbacks, JavaScript handlers, cookie/session access, and webview lifecycle events on both platforms.

The Dart layer owns profiles, validation, progress, errors, and persistence. The JavaScript layer owns DOM interaction inside the Transparent Classroom origin. Communicate through a narrow message protocol rather than interpolating user values into JavaScript source.

Example messages:

```json
{
  "type": "start",
  "mode": "pickup",
  "childName": "Celaria",
  "notes": "Running late",
  "signaturePng": "data:image/png;base64,..."
}
```

```json
{
  "type": "state",
  "name": "selecting-child"
}
```

```json
{
  "type": "result",
  "success": true,
  "message": "Pickup submitted"
}
```

## Webview automation design

The webview must remain mounted for the duration of a submission. It can be visually minimized behind the progress UI, but a fully off-screen or background webview is not a safe assumption: iOS may throttle or suspend it, and canvas input may require a rendered view.

Register the automation as an early user script so it is present after the PIN form navigation. The script should also listen for Turbo/Hotwire transitions and use a `MutationObserver`; not every state change is a full document navigation.

The state machine should have explicit states such as:

```text
loading
entering-pin
choosing-child
choosing-mode
choosing-signer
signing
submitting
success
failure
```

Use stable selectors where available, but keep selector matching in one module and support accessible names, IDs, and narrowly scoped text fallbacks. Add timeouts, cancellation, and diagnostic state messages. Do not submit `Done` until the signature canvas has been populated and the expected signing state is visible.

The signature should be replayed as pointer events or the mechanism required by the site’s canvas library. Confirm this against real iOS and Android webviews; a base64 image alone is not necessarily sufficient if the page only submits the canvas's internal drawing state.

## Storage and security

For the first version, PINs and signatures may be stored in the app's local
profile store instead of requiring a separate secure-storage setup. This keeps
the normal usage flow frictionless. Add platform secure storage
(`Keychain` on iOS and Android Keystore-backed storage) later as an optional
hardening setting or if the threat model requires it.

- Keep PINs and signatures local to the device and out of URLs, launcher payloads, analytics, crash reports, and screenshots.
- Store non-sensitive profile metadata separately, such as in a small local database or preferences store.
- Clear webview cookies and cached credentials when a user deletes a profile or explicitly signs out.
- Treat the configured URL as untrusted input and allow only HTTPS URLs.
- Keep the JavaScript bridge limited to the configured Transparent Classroom origin.
- Do not log the signature data URL or full request bodies.

The app should ask for confirmation before the final `Done` submission during initial testing, with an explicit setting to enable automatic submission after the user verifies the workflow.

## Platform launcher behavior

“A separate home-screen icon for every child” is not equally available on both platforms and should be treated as a platform capability, not a core storage assumption.

### Android

Use Android dynamic shortcuts and, where supported, `requestPinShortcut` to ask the user to pin a child-specific launcher. The shortcut should contain only the app route/profile ID. Android may limit the number of dynamic or pinned shortcuts, and the user must approve pinning.

### iOS

iOS does not provide a general API for silently creating arbitrary home-screen icons. The app can provide:

- Dynamic app icon quick actions for a limited number of children.
- A share-sheet or “Add to Home Screen” companion flow where appropriate.
- Universal/deep links that open the app to a child profile.

The design should therefore support an in-app profile list and iOS quick actions as the fallback. Do not promise one permanent home-screen icon per child on iOS without validating the exact distribution mechanism.

## Delivery phases

1. **Scaffold:** Create the Flutter project, add `flutter_inappwebview`, establish iOS/Android builds, and add a profile model.
2. **Storage and setup:** Implement secure PIN/signature storage, profile CRUD, and the signature editor.
3. **Child action screen:** Implement deep-link routing, notes, pickup/dropoff actions, progress, cancellation, and errors.
4. **Automation prototype:** Load the real page in the webview and implement the PIN-to-signature state machine using test data and a confirmation before `Done`.
5. **Submission:** Replay signatures, enter notes, submit `Done`, and verify the success state on both platforms.
6. **Launchers:** Add Android pinned/dynamic shortcuts and iOS quick actions/deep links, with graceful fallback when platform limits apply.
7. **Hardening:** Add selector diagnostics, secure logging rules, session cleanup, offline/network handling, accessibility labels, and regression tests using a local fixture page.

## Validation strategy

Do not use the production site as the only test target. Build a local fixture that reproduces the observed screens, navigation, canvas, and success/error responses so the state machine can be tested deterministically. Keep a small number of real-device smoke tests for iOS and Android because webview cookie behavior, canvas events, and lifecycle behavior cannot be fully validated in a desktop browser.

Before enabling automatic `Done`, verify that:

- Each child profile selects only its intended child.
- Pickup and dropoff send the correct event type.
- Notes are associated with the intended submission.
- The saved signature is accepted by the site.
- A failed or interrupted run cannot be reported as successful.
- Repeated taps cannot submit duplicate events.
