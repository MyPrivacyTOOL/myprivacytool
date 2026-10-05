import Seo from "@/components/Seo";
import JourneyGuide from "@/components/JourneyGuide";

const Journey = () => (
  <>
    <Seo
      title="Get clean before you go agentic | MyPrivacyTOOL"
      description="An 8-step guide: see your footprint, erase it, then bring AI agents on board safely. Start with the free scan."
      path="/journey"
    />
    <main className="container mx-auto px-4 py-10 sm:py-14">
      <header className="text-center max-w-2xl mx-auto mb-10">
        <h1 className="text-3xl sm:text-5xl font-bold text-foreground mb-4">
          Get clean before you go agentic
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground">
          Every agent you launch inherits your footprint. Fix yours first, then extend the same
          approach to your agents. Pick a step to see what happens and what to do.
        </p>
      </header>
      <JourneyGuide />
    </main>
  </>
);

export default Journey;
