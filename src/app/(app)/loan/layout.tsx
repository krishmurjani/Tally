import { LoanTabs } from "./loan-tabs";

export default function LoanLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">HDFC Credila education loan</h1>
        <LoanTabs />
      </div>
      {children}
    </div>
  );
}
