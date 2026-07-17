import ProxyBalanceCard from "@/components/ProxyBalanceCard";

const ProxyPage = () => {
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Monitor de Proxy</h1>
      <ProxyBalanceCard />
    </div>
  );
};

export default ProxyPage;
