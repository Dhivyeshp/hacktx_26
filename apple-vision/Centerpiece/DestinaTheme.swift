import SwiftUI
import CoreText

/// Destina's design language, ported from `src/design-tokens.css` and
/// `docs/destina-design-spec.md`.
///
/// Palette rules that have to hold: tan is the only accent and appears on the
/// primary button, the active indicator and focus rings; sage appears only on
/// status dots; muted text never crosses between the charcoal and cream
/// surfaces. Shapes are square hairlines rather than rounded cards, with the
/// pill primary button as the one deliberate exception.
enum Destina {
    static let bg = Color(hex: 0x262722)
    static let bgRaised = Color(hex: 0x2F302A)
    static let line = Color(hex: 0x45463F)
    static let cream = Color(hex: 0xECE8DD)
    static let cream2 = Color(hex: 0xDEDCD1)
    static let lineLight = Color(hex: 0xC9C6BA)
    static let text = Color(hex: 0xEEEAE0)
    static let textMuted = Color(hex: 0xA8A69B)
    static let ink = Color(hex: 0x26271F)
    static let inkMuted = Color(hex: 0x5C5B52)
    static let tan = Color(hex: 0xC49A63)
    static let tanHover = Color(hex: 0xD8B27F)
    static let tanDeep = Color(hex: 0x9A7244)
    static let sage = Color(hex: 0x8E9C7E)

    // MARK: - Type
    //
    // Headings are italic Cormorant Garamond; that is the signature of the
    // brand and it carries over unchanged. UI text is Space Grotesk. The
    // families are registered at launch, and every call falls back to a system
    // font so a missing resource degrades rather than crashes.

    enum Family {
        static let unicase = "Cormorant Unicase"
        static let garamond = "Cormorant Garamond"
        static let grotesk = "Space Grotesk"
    }

    static func wordmark(_ size: CGFloat) -> Font {
        custom(Family.unicase, size: size, fallback: .system(size: size, weight: .medium, design: .serif))
    }
    static func heading(_ size: CGFloat) -> Font {
        custom(Family.garamond, size: size, fallback: .system(size: size, weight: .medium, design: .serif))
            .italic()
    }
    static func ui(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        custom(Family.grotesk, size: size, weight: weight, fallback: .system(size: size, weight: weight))
    }

    private static func custom(_ name: String, size: CGFloat, weight: Font.Weight = .regular,
                               fallback: Font) -> Font {
        registerFonts()
        guard availableFamilies.contains(name) else { return fallback }
        return .custom(name, fixedSize: size).weight(weight)
    }

    private nonisolated(unsafe) static var registered = false
    private nonisolated(unsafe) static var availableFamilies: Set<String> = []

    /// Registering at runtime avoids declaring every face in the synthetic
    /// project file, which would have to be hand-edited for each one.
    static func registerFonts() {
        guard !registered else { return }
        registered = true
        let names = [
            "cormorant-unicase-400", "cormorant-unicase-500", "cormorant-unicase-600",
            "cormorant-garamond-500-normal", "cormorant-garamond-500-italic",
            "space-grotesk-400", "space-grotesk-500", "space-grotesk-600", "space-grotesk-700"
        ]
        for name in names {
            guard let url = Bundle.main.url(forResource: name, withExtension: "ttf") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
        for family in UIFont.familyNames { availableFamilies.insert(family) }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

// MARK: - Surfaces

extension View {
    /// Destina panels are square hairline frames with no shadow. Against
    /// passthrough they also need a substrate to stay legible, so the hairline
    /// sits on a material rather than replacing it.
    func destinaPanel(_ padding: CGFloat = 18) -> some View {
        self
            .padding(padding)
            .background(Destina.bg.opacity(0.82))
            .background(.regularMaterial)
            .overlay(Rectangle().stroke(Destina.line, lineWidth: 1))
    }

    /// A cream panel inverts the text roles the way `.panel` does on the web.
    func destinaCreamPanel(_ padding: CGFloat = 18) -> some View {
        self
            .padding(padding)
            .foregroundStyle(Destina.ink)
            .background(Destina.cream)
            .overlay(Rectangle().stroke(Destina.lineLight, lineWidth: 1))
    }

    func destinaInset(_ padding: CGFloat = 12) -> some View {
        self
            .padding(padding)
            .background(Destina.bgRaised)
            .overlay(Rectangle().stroke(Destina.line, lineWidth: 1))
    }
}

/// 12pt uppercase with wide tracking, the web `.eyebrow`.
struct Eyebrow: View {
    let text: String
    var tint: Color = Destina.textMuted
    init(_ text: String, tint: Color = Destina.textMuted) {
        self.text = text
        self.tint = tint
    }
    var body: some View {
        Text(text.uppercased())
            .font(Destina.ui(11, weight: .medium))
            .tracking(2)
            .foregroundStyle(tint)
    }
}

/// The one rounded element. Tan on ink, 44pt tall like every other target.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Destina.ui(15, weight: .medium))
            .foregroundStyle(Destina.ink)
            .padding(.horizontal, 22)
            .frame(minHeight: 44)
            .background(
                Capsule().fill(
                    isEnabled
                        ? (configuration.isPressed ? Destina.tanDeep : Destina.tan)
                        : Destina.line
                )
            )
            .opacity(isEnabled ? 1 : 0.6)
            .contentShape(Capsule())
            .hoverEffect(.highlight)
    }
}

/// Square hairline button for everything that is not the single primary action.
///
/// `onCream` is not decoration. The charcoal and cream surfaces invert the text
/// roles, and a button that keeps its light label on a cream panel renders as
/// an empty box.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var destructive = false
    var onCream = false

    private var label: Color {
        if destructive { return onCream ? Destina.tanDeep : Destina.tanHover }
        return onCream ? Destina.ink : Destina.text
    }
    private var border: Color { onCream ? Destina.lineLight : Destina.line }
    private var pressed: Color { onCream ? Destina.cream2 : Destina.bgRaised }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Destina.ui(14, weight: .medium))
            .foregroundStyle(label)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(configuration.isPressed ? pressed : Color.clear)
            .overlay(Rectangle().stroke(border, lineWidth: 1))
            .opacity(isEnabled ? 1 : 0.45)
            .contentShape(Rectangle())
            .hoverEffect(.highlight)
    }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var destinaSecondary: SecondaryButtonStyle { SecondaryButtonStyle() }
    static var destinaDestructive: SecondaryButtonStyle { SecondaryButtonStyle(destructive: true) }
    static var destinaSecondaryOnCream: SecondaryButtonStyle { SecondaryButtonStyle(onCream: true) }
}
extension ButtonStyle where Self == PrimaryButtonStyle {
    static var destinaPrimary: PrimaryButtonStyle { PrimaryButtonStyle() }
}

/// Sage for ready, tan for attention. Status is the only place either appears.
struct StatusDot: View {
    let ok: Bool
    var body: some View {
        Circle()
            .fill(ok ? Destina.sage : Destina.tan)
            .frame(width: 7, height: 7)
            .accessibilityHidden(true)
    }
}
