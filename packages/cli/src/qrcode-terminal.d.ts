declare module "qrcode-terminal" {
  interface GenerateOptions {
    small?: boolean;
  }

  interface QrCodeTerminal {
    generate(input: string, callback: (output: string) => void): void;
    generate(input: string, options?: GenerateOptions): void;
    generate(input: string, options: GenerateOptions, callback: (output: string) => void): void;
    setErrorLevel(level: "L" | "M" | "Q" | "H"): void;
  }

  const qrcode: QrCodeTerminal;
  export default qrcode;
}
