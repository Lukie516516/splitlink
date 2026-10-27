import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { CreatePage } from "./components/CreatePage";
import { PayPage } from "./components/PayPage";
import { WalletProvider } from "./hooks/useWallet";
export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/create" replace />} />
            <Route path="/create" element={<CreatePage />} />
            <Route
              path="/pay/:chainId/:contractAddress/:requestId"
              element={<PayPage />}
            />
            <Route
              path="/receipt/:chainId/:contractAddress/:requestId"
              element={<PayPage receiptOnly />}
            />
            <Route path="*" element={<h1>Unknown route.</h1>} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </WalletProvider>
  );
}
