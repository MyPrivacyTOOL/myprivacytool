import { BarChart3, Users, Globe, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface StatsDashboardProps {
  feedbackStats: {
    correct: number;
    incorrect: number;
  };
}

export default function StatsDashboard({ feedbackStats }: StatsDashboardProps) {
  const totalFeedback = feedbackStats.correct + feedbackStats.incorrect;
  const accuracy = totalFeedback > 0 
    ? Math.round((feedbackStats.correct / totalFeedback) * 100) 
    : 85; // Simulated baseline

  // Simulated aggregate statistics
  const stats = {
    totalPredictions: 1234 + totalFeedback,
    accuracy,
    commonLanguages: [
      { language: 'English', percentage: 45 },
      { language: 'Spanish', percentage: 22 },
      { language: 'French', percentage: 12 },
      { language: 'German', percentage: 8 },
      { language: 'Other', percentage: 13 },
    ],
    userProfiles: [
      { profile: 'Local', percentage: 58 },
      { profile: 'Multilingual', percentage: 24 },
      { profile: 'Expatriate', percentage: 12 },
      { profile: 'Traveler', percentage: 6 },
    ],
  };

  return (
    <Card className="glass-card border-primary/20">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BarChart3 className="w-5 h-5 text-primary" />
          Analytics Dashboard
          <span className="text-xs font-normal text-muted-foreground ml-2">(Simulated)</span>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="p-6">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="text-center p-4 bg-muted/30 rounded-lg">
            <div className="text-2xl font-bold text-primary">{stats.totalPredictions.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Total Predictions</div>
          </div>
          <div className="text-center p-4 bg-muted/30 rounded-lg">
            <div className="text-2xl font-bold text-green-500">{stats.accuracy}%</div>
            <div className="text-xs text-muted-foreground">Accuracy Rate</div>
          </div>
          <div className="text-center p-4 bg-muted/30 rounded-lg">
            <div className="text-2xl font-bold text-blue-500">6</div>
            <div className="text-xs text-muted-foreground">Signals Detected</div>
          </div>
          <div className="text-center p-4 bg-muted/30 rounded-lg">
            <div className="text-2xl font-bold text-purple-500">4</div>
            <div className="text-xs text-muted-foreground">Profile Types</div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Language Distribution */}
          <div>
            <h4 className="flex items-center gap-2 font-medium mb-4">
              <Globe className="w-4 h-4 text-primary" />
              Common Languages
            </h4>
            <div className="space-y-3">
              {stats.commonLanguages.map((item) => (
                <div key={item.language}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{item.language}</span>
                    <span className="text-muted-foreground">{item.percentage}%</span>
                  </div>
                  <Progress value={item.percentage} className="h-2" />
                </div>
              ))}
            </div>
          </div>

          {/* User Profile Distribution */}
          <div>
            <h4 className="flex items-center gap-2 font-medium mb-4">
              <Users className="w-4 h-4 text-primary" />
              User Profiles
            </h4>
            <div className="space-y-3">
              {stats.userProfiles.map((item) => (
                <div key={item.profile}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{item.profile}</span>
                    <span className="text-muted-foreground">{item.percentage}%</span>
                  </div>
                  <Progress value={item.percentage} className="h-2" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Trending Insight */}
        <div className="mt-6 p-4 bg-primary/5 rounded-lg border border-primary/10">
          <div className="flex items-start gap-3">
            <TrendingUp className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h5 className="font-medium text-sm mb-1">Trending Pattern</h5>
              <p className="text-sm text-muted-foreground">
                Users with 3+ configured languages are 4x more likely to be classified as "multilingual" 
                with 92% accuracy compared to single-language users.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
