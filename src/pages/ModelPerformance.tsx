import { Helmet } from 'react-helmet';
import ModelDashboard from '@/components/ModelDashboard';

export default function ModelPerformance() {
  return (
    <>
      <Helmet>
        <title>Model Performance Dashboard | MyPrivacyTOOL</title>
        <meta name="description" content="View complete AI learning system analytics including accuracy trends, reward signals, and model improvements." />
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <ModelDashboard />
    </>
  );
}