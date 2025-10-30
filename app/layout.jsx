export const metadata = {
  title: 'Recepty – sdílený katalog',
  description: 'Vlož odkaz, sdílej recepty online.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="cs">
      <body style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', background: '#fafafa', color: '#111', margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
