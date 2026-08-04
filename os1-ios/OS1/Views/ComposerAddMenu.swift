import SwiftUI
import PhotosUI
#if canImport(UIKit)
import UIKit
#endif

/// The composer's "+" — the web input's add menu, natively. Attaching an image
/// is one row inside it rather than the whole button: the same menu carries the
/// camera, the session goal and team notes, which is everything the paperclip
/// it replaced could never say it did.
///
/// The rows are deliberately mode-aware. Writing a team note posts to the
/// session's chat channel (no attachment endpoint behind it), so the picker
/// rows step aside while note mode is on instead of offering an attachment the
/// send would silently drop.
struct ComposerAddMenu: View {
    @Binding var images: [AttachedImage]
    var noteMode: Bool
    var hasGoal: Bool = false
    /// Nil when the session can't take a goal — `/goal` is a backstage-native
    /// slash command, so Slack/Linear-sourced chats don't get the row.
    var onSetGoal: (() -> Void)?
    var onToggleNoteMode: () -> Void
    var maxCount: Int = 6

    @State private var pickerItems: [PhotosPickerItem] = []
    #if os(iOS)
    @State private var showingPhotos = false
    @State private var showingCamera = false
    #else
    @State private var importing = false
    #endif

    private var remaining: Int { max(0, maxCount - images.count) }

    var body: some View {
        Menu {
            if !noteMode {
                Button {
                    #if os(iOS)
                    showingPhotos = true
                    #else
                    importing = true
                    #endif
                } label: {
                    Label(attachLabel, systemImage: "photo.on.rectangle")
                }
                .disabled(remaining == 0)

                #if os(iOS)
                if CameraPicker.isAvailable {
                    Button {
                        showingCamera = true
                    } label: {
                        Label("Take a photo", systemImage: "camera")
                    }
                    .disabled(remaining == 0)
                }
                #endif
            }

            if let onSetGoal {
                Button(action: onSetGoal) {
                    Label(hasGoal ? "Edit goal" : "Set a goal", systemImage: "target")
                }
            }

            Button(action: onToggleNoteMode) {
                Label(
                    noteMode ? "Back to prompting" : "Write a team note",
                    systemImage: "note.text"
                )
            }
        } label: {
            icon
        }
        .menuIndicator(.hidden)
        // A Menu tints its own label, which paints the "+" accent-red over the
        // secondary mic beside it — the glyph is a quiet affordance, not a
        // call to action. Tinting the menu (not just the label) is what sticks.
        .tint(OS1VisualStyle.textDim)
        .buttonStyle(.plain)
        #if os(macOS)
        .menuStyle(.button)
        .fixedSize()
        #endif
        .accessibilityLabel("Attach files and chat options")
        #if os(iOS)
        .photosPicker(
            isPresented: $showingPhotos,
            selection: $pickerItems,
            maxSelectionCount: remaining,
            matching: .images
        )
        .onChange(of: pickerItems) {
            guard !pickerItems.isEmpty else { return }
            let picked = pickerItems
            pickerItems = []
            Task {
                for item in picked {
                    guard let data = try? await item.loadTransferable(type: Data.self)
                    else { continue }
                    append(data)
                }
            }
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker { data in append(data) }
                .ignoresSafeArea()
        }
        #else
        .fileImporter(
            isPresented: $importing,
            allowedContentTypes: [.image],
            allowsMultipleSelection: true
        ) { result in
            guard case .success(let urls) = result else { return }
            for url in urls.prefix(remaining) {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                guard let data = try? Data(contentsOf: url) else { continue }
                append(data)
            }
        }
        #endif
    }

    private var attachLabel: String {
        #if os(iOS)
        "Photo library"
        #else
        "Attach an image"
        #endif
    }

    private func append(_ data: Data) {
        guard images.count < maxCount, let image = AttachedImage(rawData: data)
        else { return }
        images.append(image)
    }

    /// Same metrics as the send/mic buttons beside it: a secondary glyph in a
    /// full-size tap target, so the row reads as one set of controls.
    private var icon: some View {
        Image(systemName: "plus")
            .font(.system(size: 18, weight: .medium))
            .foregroundStyle(OS1VisualStyle.textDim)
            #if os(iOS)
            .frame(width: 44, height: 44)
            #else
            .frame(width: 27, height: 27)
            #endif
            .contentShape(Circle())
    }
}

/// Editor for the session goal. A goal is appended to every prompt in the chat
/// until it's cleared, so the sheet offers clearing as plainly as setting.
struct GoalSheet: View {
    let hadGoal: Bool
    let onSubmit: (String?) -> Void

    @State private var text: String
    @Environment(\.dismiss) private var dismiss

    init(initial: String, hadGoal: Bool, onSubmit: @escaping (String?) -> Void) {
        _text = State(initialValue: initial)
        self.hadGoal = hadGoal
        self.onSubmit = onSubmit
    }

    private var trimmed: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Session goal")
                .font(.headline)
            Text("Rides every prompt in this chat until you clear it.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            TextField(
                "What should this session keep working toward?",
                text: $text,
                axis: .vertical
            )
            .lineLimit(3...6)
            .textFieldStyle(.roundedBorder)

            HStack {
                if hadGoal {
                    Button("Clear goal", role: .destructive) {
                        onSubmit(nil)
                        dismiss()
                    }
                }
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Set goal") {
                    onSubmit(trimmed)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(trimmed.isEmpty)
            }
        }
        .padding(20)
        .frame(minWidth: 320)
        #if os(iOS)
        .presentationDetents([.medium])
        #endif
    }
}

#if os(iOS)
/// UIKit's camera, wrapped — SwiftUI has no camera picker of its own, and the
/// photo library picker can't take a new shot.
struct CameraPicker: UIViewControllerRepresentable {
    static var isAvailable: Bool {
        UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    let onCapture: (Data) -> Void

    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate,
        UINavigationControllerDelegate
    {
        private let parent: CameraPicker

        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            // The raw capture is re-encoded by AttachedImage (downscale +
            // JPEG), so hand over the least-lossy data we have.
            if let image = info[.originalImage] as? UIImage,
               let data = image.jpegData(compressionQuality: 0.95) {
                parent.onCapture(data)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
#endif
