import SwiftUI

/// Model, reasoning effort and speed for the next turn, as one row per
/// setting: each row names its current value and opens a submenu, mirroring
/// the web composer's pill menu.
///
/// Mounted twice so the two surfaces can't drift: the macOS toolbar's own
/// control, and the iOS session overflow menu, where these settings used to be
/// reachable only by opening the worktree details sheet.
///
/// Its own view struct for the reason `SessionActionsMenu` is: it reads
/// `effort`, `fastMode` and `usage`, and reading those inside
/// `SessionView.body` re-evaluates the whole body, transcript included, every
/// time one of them moves.
struct ModelSettingsMenu: View {
    let viewModel: SessionViewModel
    let catalog: ModelCatalog?
    /// Conversation cost, above the choices that drive it. Carried where this
    /// is the whole menu; suppressed where it is nested inside one, since
    /// spend is not a model setting and the row would read as one.
    var showsUsage = true

    var body: some View {
        if showsUsage {
            UsageMenuSection(usage: viewModel.usage)
        }
        if let catalog {
            Menu {
                ForEach(catalog.presets + catalog.regular) { option in
                    Button {
                        viewModel.changeModel(to: option.id)
                    } label: {
                        if option.id == currentModel {
                            Label(option.displayLabel, systemImage: "checkmark")
                        } else {
                            Text(option.displayLabel)
                        }
                    }
                }
            } label: {
                Label("Model · \(catalog.label(for: currentModel))", systemImage: "cpu")
            }
        }
        if !supportedEfforts.isEmpty {
            Menu {
                ForEach(supportedEfforts, id: \.self) { level in
                    Button {
                        viewModel.effort = level
                    } label: {
                        // Checked against the RESOLVED effort, not the stored
                        // one: "" means the server's default rather than no
                        // choice, so comparing the raw value leaves an
                        // untouched session with nothing checked at all.
                        if effectiveEffort == level {
                            Label(EffortLevel.label(level), systemImage: "checkmark")
                        } else {
                            Text(EffortLevel.label(level))
                        }
                    }
                }
            } label: {
                Label("Effort · \(EffortLevel.label(effectiveEffort))", systemImage: "brain")
            }
        }
        if catalog?.option(for: currentModel)?.fastModeSupported == true {
            Menu {
                ForEach([false, true], id: \.self) { fast in
                    Button {
                        viewModel.fastMode = fast
                    } label: {
                        if viewModel.fastMode == fast {
                            Label(Self.speedLabel(fast), systemImage: "checkmark")
                        } else {
                            Text(Self.speedLabel(fast))
                        }
                    }
                }
            } label: {
                Label(
                    "Speed · \(Self.speedLabel(viewModel.fastMode))",
                    systemImage: "bolt"
                )
            }
        }
        Section {
            Button(action: reset) {
                Label("Reset to default", systemImage: "arrow.uturn.backward")
            }
            .disabled(isAtDefault)
        }
    }

    /// Fast mode reads as a speed, so it sits beside Effort as a value rather
    /// than as a switch of its own. Same wording as the web menu.
    private static func speedLabel(_ fast: Bool) -> String {
        fast ? "Fast" : "Standard"
    }

    private var currentModel: String {
        viewModel.model.isEmpty ? (catalog?.defaultModel ?? "") : viewModel.model
    }

    private var supportedEfforts: [String] {
        catalog?.option(for: currentModel)?.efforts ?? []
    }

    /// What the next turn will actually run at. `effort` is "" until someone
    /// picks one, and a model that dropped the stored level since then leaves
    /// it stale, so both fall back the way the server does.
    private var effectiveEffort: String {
        let efforts = supportedEfforts
        if efforts.contains(viewModel.effort) { return viewModel.effort }
        return efforts.contains("high") ? "high" : (efforts.first ?? "")
    }

    /// Nothing to put back: following the default model, no effort picked, and
    /// standard speed. Drives the reset row's disabled state, so it doubles as
    /// the answer to "am I on the defaults?".
    private var isAtDefault: Bool {
        let defaultModel = catalog?.defaultModel ?? ""
        let onDefaultModel =
            viewModel.model.isEmpty || defaultModel.isEmpty || viewModel.model == defaultModel
        return onDefaultModel && viewModel.effort.isEmpty && !viewModel.fastMode
    }

    private func reset() {
        // `/model` has no "follow the default" form — the web sends "" through
        // its own picker, but the slash command takes an id — so this pins the
        // default id. The next run resolves to the same model either way.
        if let defaultModel = catalog?.defaultModel, !defaultModel.isEmpty {
            viewModel.changeModel(to: defaultModel)
        }
        // `changeModel` clears both itself, but it no-ops when the model is
        // already the default, which is the common case for a reset.
        viewModel.effort = ""
        viewModel.fastMode = false
    }
}
