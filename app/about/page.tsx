import Link from "next/link";
import { Card, Screen, ScreenTitle } from "@/components/ui";

export const metadata = { title: "About" };

export default function AboutPage() {
  return (
    <Screen dock={false}>
      <div className="flex h-[60px] items-center">
        <Link href="/" className="font-semibold text-accent">
          Back
        </Link>
      </div>
      <ScreenTitle sub="An invite-only food logger for the full Australian nutrition panel.">About Fatty</ScreenTitle>
      <div className="flex flex-col gap-3">
        <Card>
          <h2 className="text-[17px] font-semibold">Food data</h2>
          <p className="mt-2 text-[15px] leading-[1.45] text-ink2">
            Food composition data from Food Standards Australia New Zealand (FSANZ): <b className="font-medium text-ink">AUSNUT 2023</b> and the{" "}
            <b className="font-medium text-ink">Australian Food Composition Database, Release 3</b>. Used under FSANZ&apos;s licence terms. FSANZ does not endorse this app.
          </p>
          <p className="mt-2 text-[15px] leading-[1.45] text-ink2">
            Packaged food data from <b className="font-medium text-ink">Open Food Facts</b>, made available under the{" "}
            <a href="https://opendatacommons.org/licenses/odbl/1-0/" className="font-semibold text-accent">Open Database License</a>. Individual contents under the{" "}
            <a href="https://opendatacommons.org/licenses/dbcl/1-0/" className="font-semibold text-accent">Database Contents License</a>.{" "}
            <a href="https://world.openfoodfacts.org" className="font-semibold text-accent">openfoodfacts.org</a>
          </p>
          <p className="mt-2 text-[15px] leading-[1.45] text-ink2">Foods read from labels are added by the people who use Fatty and shared with everyone here.</p>
        </Card>
        <Card>
          <h2 className="text-[17px] font-semibold">How numbers are worked out</h2>
          <p className="mt-2 text-[15px] leading-[1.45] text-ink2">
            Nutrients always come from a database or a label someone has checked, never from an AI guess. A missing value shows as “–” and is never counted as zero. Energy targets use the
            Mifflin-St Jeor formula and your activity; they are estimates, so judge progress by your weight trend. Macro energy uses the Food Standards Code factors (protein and
            carbohydrate 17 kJ/g, fat 37 kJ/g).
          </p>
        </Card>
        <Card>
          <h2 className="text-[17px] font-semibold">Type</h2>
          <p className="mt-2 text-[15px] leading-[1.45] text-ink2">Geist, by Vercel, under the SIL Open Font License.</p>
        </Card>
      </div>
    </Screen>
  );
}
