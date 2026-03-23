import "./globals.css";

export const metadata = {
  title: "KIRIGUMI",
  description: "AI course builder with adaptive lessons, resources, and mastery tracking.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
