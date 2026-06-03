"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useOutlayerOnboarding } from "./hooks/useOutlayerOnboarding";
import ConnectScreen from "./components/ConnectScreen";
import ConfigScreen from "./components/ConfigScreen";
import ClaimScreen from "./components/ClaimScreen";
import FundScreen from "./components/FundScreen";
import PolicyScreen from "./components/PolicyScreen";
import RegisterScreen from "./components/RegisterScreen";
import SkillInstallScreen from "./components/SkillInstallScreen";
import SuccessScreen from "./components/SuccessScreen";

export default function OnboardIronclawPage() {
  const auth = useAuth();
  const onboard = useOutlayerOnboarding();

  // Auto-advance off the 'connect' step once a wallet is connected. Using an
  // effect avoids the React anti-pattern of dispatching during render.
  useEffect(() => {
    if (auth.accountId && onboard.state.step === "connect") {
      onboard.advance("config");
    }
  }, [auth.accountId, onboard]);

  if (!auth.accountId) return <ConnectScreen {...auth} />;

  switch (onboard.state.step) {
    case "connect":
      // Effect above will flip us to 'config' next render.
      return null;
    case "config":
      return <ConfigScreen onboard={onboard} auth={auth} />;
    case "register":
      return onboard.state.path === "B_bound" ? (
        <ClaimScreen onboard={onboard} />
      ) : (
        <RegisterScreen onboard={onboard} auth={auth} mode="anonymous" />
      );
    case "fund":
      return <FundScreen onboard={onboard} />;
    case "policy":
      return <PolicyScreen onboard={onboard} auth={auth} />;
    case "autonomous":
      return <RegisterScreen onboard={onboard} auth={auth} mode="autonomous" />;
    case "install":
      return <SkillInstallScreen onboard={onboard} />;
    case "success":
      return <SuccessScreen onboard={onboard} />;
  }
}
