import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  StatusBar,
  Platform,
  AppState,
  Dimensions,
  FlatList,
  Alert,
  ScrollView,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { 
  Play, 
  Square, 
  ChevronLeft, 
  ChevronRight, 
  BarChart2, 
  Clock, 
  PieChart as PieIcon,
  BookOpen,
  Calendar
} from 'lucide-react-native';
import { supabase } from './lib/supabase';

const { width } = Dimensions.get('window');
const TIMER_SIZE = width * 0.74;
const CHANNEL_ID = 'default';

const SUBJECTS = ['Physics', 'Chemistry', 'Maths'];
const SUBJECT_COLORS = {
  Physics: { primary: '#3B82F6', light: 'rgba(59, 130, 246, 0.10)', text: '#60A5FA' },
  Chemistry: { primary: '#A855F7', light: 'rgba(168, 85, 247, 0.10)', text: '#C084FC' },
  Maths: { primary: '#10B981', light: 'rgba(16, 185, 129, 0.10)', text: '#34D399' },
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const intervals = [0.25, 0.5, 1, 5, 10, 25, 50];
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(intervals[selectedIdx] * 60);
  const [isActive, setIsActive] = useState(false);
  const [sessions, setSessions] = useState([]);
  
  const [selectedSubject, setSelectedSubject] = useState('Physics');
  const [activeTab, setActiveTab] = useState('timer'); 
  const [currentWeekOffset, setCurrentWeekOffset] = useState(0); 

  const timerRef = useRef(null);
  const endTimeRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const sessionIdRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') {
        Alert.alert('Notifications disabled', 'Enable notifications in settings.');
      }
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
          name: 'Focus Timer',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#6366F1',
          sound: 'default',
        });
      }
    })();
  }, []);

  const fetchSessions = useCallback(async () => {
    const { data, error } = await supabase
      .from('focus_sessions')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(100);

    if (error) {
      console.warn('Failed to fetch sessions:', error.message);
      return;
    }
    setSessions(data ?? []);
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    if (!isActive) {
      setSecondsLeft(intervals[selectedIdx] * 60);
    }
  }, [selectedIdx, isActive]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (isActive && appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        if (endTimeRef.current) {
          const now = Date.now();
          const remaining = Math.max(0, Math.round((endTimeRef.current - now) / 1000));
          if (remaining <= 0) {
            setIsActive(false);
            setSecondsLeft(0);
          } else {
            setSecondsLeft(remaining);
          }
        }
      }
      appStateRef.current = nextAppState;
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [isActive]);

  useEffect(() => {
    if (isActive) {
      timerRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            setIsActive(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isActive]);

  useEffect(() => {
    if (secondsLeft === 0 && sessionIdRef.current) {
      const plannedDuration = intervals[selectedIdx] * 60;
      closeSession({ completed: true, actualDurationSeconds: plannedDuration });
    }
  }, [secondsLeft]);

  const closeSession = useCallback(
    async ({ completed, actualDurationSeconds }) => {
      if (!sessionIdRef.current) return;
      const idToClose = sessionIdRef.current;
      sessionIdRef.current = null;

      const { error } = await supabase
        .from('focus_sessions')
        .update({
          stopped_at: new Date().toISOString(),
          actual_duration_seconds: actualDurationSeconds,
          completed,
        })
        .eq('id', idToClose);

      if (error) console.warn('Failed to close session:', error.message);
      fetchSessions();
    },
    [fetchSessions]
  );

  const toggleTimer = async () => {
    if (isActive) {
      setIsActive(false);
      endTimeRef.current = null;
      await Notifications.cancelAllScheduledNotificationsAsync();
    } else {
      if (secondsLeft > 0) {
        setIsActive(true);
        const nowMs = Date.now();
        endTimeRef.current = nowMs + secondsLeft * 1000;

        if (!sessionIdRef.current) {
          const plannedDuration = intervals[selectedIdx] * 60;
          const { data, error } = await supabase
            .from('focus_sessions')
            .insert({
              started_at: new Date(nowMs).toISOString(),
              planned_duration_seconds: plannedDuration,
              subject: selectedSubject,
            })
            .select()
            .single();

          if (error) {
            console.warn('Failed to create session:', error.message);
          } else {
            sessionIdRef.current = data.id;
          }
        }

        if (secondsLeft > 10) {
          await Notifications.scheduleNotificationAsync({
            content: { title: 'Focus Session wrapping up...', body: '10 seconds remaining!', sound: true },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: secondsLeft - 10,
              channelId: CHANNEL_ID,
            },
          });
        }
        await Notifications.scheduleNotificationAsync({
          content: { title: 'Focus Session Complete!', body: 'Great session. Time for a quick break.', sound: true },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: secondsLeft,
            channelId: CHANNEL_ID,
          },
        });
      }
    }
  };

  const resetTimer = async () => {
    setIsActive(false);
    endTimeRef.current = null;
    await Notifications.cancelAllScheduledNotificationsAsync();

    if (sessionIdRef.current) {
      const plannedDuration = intervals[selectedIdx] * 60;
      const actual = plannedDuration - secondsLeft;
      await closeSession({ completed: false, actualDurationSeconds: actual });
    }
    setSecondsLeft(intervals[selectedIdx] * 60);
  };

  const changeDuration = () => {
    if (isActive) return;
    const nextIdx = (selectedIdx + 1) % intervals.length;
    setSelectedIdx(nextIdx);
  };

  const changeSubject = () => {
    if (isActive) return;
    const currentIdx = SUBJECTS.indexOf(selectedSubject);
    const nextIdx = (currentIdx + 1) % SUBJECTS.length;
    setSelectedSubject(SUBJECTS[nextIdx]);
  };

  const formatTime = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatSessionRow = (item) => {
    const started = new Date(item.started_at);
    const dateLabel = started.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const timeLabel = started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const durationLabel = item.actual_duration_seconds ? formatTime(item.actual_duration_seconds) : '00:00';
    return { dateLabel, timeLabel, durationLabel };
  };

  const getWeekRange = (weekOffset) => {
    const startOfWeek = new Date();
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); 
    startOfWeek.setDate(diff + (weekOffset * 7));
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    return { startOfWeek, endOfWeek };
  };

  const getAnalyticsData = () => {
    const { startOfWeek, endOfWeek } = getWeekRange(currentWeekOffset);
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    const weeklyData = days.map((day, idx) => {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + idx);
      return {
        day,
        dateString: date.toLocaleDateString([], { month: 'numeric', day: 'numeric' }),
        totalSeconds: 0,
        Physics: 0,
        Chemistry: 0,
        Maths: 0,
      };
    });

    let totalDurationInWeek = 0;
    const subjectSummary = { Physics: 0, Chemistry: 0, Maths: 0 };

    sessions.forEach((session) => {
      const sessionDate = new Date(session.started_at);
      if (sessionDate >= startOfWeek && sessionDate <= endOfWeek) {
        const secs = session.actual_duration_seconds || 0;
        const dayIdx = sessionDate.getDay() === 0 ? 6 : sessionDate.getDay() - 1;
        
        weeklyData[dayIdx].totalSeconds += secs;
        totalDurationInWeek += secs;

        const sub = session.subject || 'Physics';
        if (weeklyData[dayIdx][sub] !== undefined) weeklyData[dayIdx][sub] += secs;
        if (subjectSummary[sub] !== undefined) subjectSummary[sub] += secs;
      }
    });

    return { weeklyData, totalDurationInWeek, subjectSummary, startOfWeek, endOfWeek };
  };

  const { weeklyData, totalDurationInWeek, subjectSummary, startOfWeek, endOfWeek } = getAnalyticsData();
  const maxSecondsInDay = Math.max(...weeklyData.map((d) => d.totalSeconds), 60);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0B0F" />

      {/* Clean Global Tab Navigation Header */}
      <View style={styles.header}>
        <View style={styles.headerTabWrapper}>
          <TouchableOpacity 
            onPress={() => setActiveTab('timer')} 
            style={[styles.tabButton, activeTab === 'timer' && styles.activeTabButton]}
          >
            <Text style={[styles.tabText, activeTab === 'timer' && styles.activeTabText]}>Timer</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => setActiveTab('analytics')} 
            style={[styles.tabButton, activeTab === 'analytics' && styles.activeTabButton]}
          >
            <Text style={[styles.tabText, activeTab === 'analytics' && styles.activeTabText]}>Analytics</Text>
          </TouchableOpacity>
        </View>
      </View>

      {activeTab === 'timer' ? (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.timerContainer}>
            <TouchableOpacity
              activeOpacity={isActive ? 0.95 : 0.7}
              onPress={changeDuration}
              style={[
                styles.dialButton,
                { borderColor: isActive ? SUBJECT_COLORS[selectedSubject].primary : '#1F1F24' },
              ]}
            >
              <View 
                style={[
                  styles.progressTrack, 
                  { 
                    backgroundColor: SUBJECT_COLORS[selectedSubject].primary,
                    opacity: isActive ? 0.03 : 0 
                  }
                ]} 
              />

              <Text style={styles.timerText}>{formatTime(secondsLeft)}</Text>
              
              {!isActive ? (
                <TouchableOpacity 
                  onPress={changeSubject} 
                  activeOpacity={0.7}
                  style={[
                    styles.subjectSelectorBadge, 
                    { backgroundColor: SUBJECT_COLORS[selectedSubject].light }
                  ]}
                >
                  <BookOpen size={13} color={SUBJECT_COLORS[selectedSubject].text} style={{ marginRight: 6 }} />
                  <Text style={[styles.subjectSelectorText, { color: SUBJECT_COLORS[selectedSubject].text }]}>
                    {selectedSubject}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={[styles.runningText, { color: SUBJECT_COLORS[selectedSubject].text }]}>
                  {selectedSubject}
                </Text>
              )}
              
              {/* {!isActive && <Text style={styles.hintText}>Tap dial to change duration</Text>} */}
            </TouchableOpacity>
          </View>

          {/* Clean Functional Controls */}
          <View style={styles.controlsContainer}>
            <TouchableOpacity style={styles.actionButton} onPress={toggleTimer}>
              <Play
                size={18}
                color={isActive ? '#EF4444' : '#10B981'}
                fill={isActive ? '#EF4444' : '#10B981'}
                style={{ marginRight: 6 }}
              />
              <Text style={styles.actionText}>{isActive ? 'Pause' : 'Start'}</Text>
            </TouchableOpacity>

            {isActive && (
              <TouchableOpacity style={[styles.actionButton, styles.stopButton]} onPress={resetTimer}>
                <Square size={14} color="#A1A1AA" fill="#A1A1AA" style={{ marginRight: 6 }} />
                <Text style={[styles.actionText, { color: '#A1A1AA' }]}>Reset</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Session History */}
          <View style={styles.historyContainer}>
            <Text style={styles.historyTitle}>SESSION HISTORY</Text>
            <FlatList
              data={sessions.slice(0, 6)}
              scrollEnabled={false}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const { dateLabel, timeLabel, durationLabel } = formatSessionRow(item);
                const sub = item.subject || 'Physics';
                const colorConfig = SUBJECT_COLORS[sub] || SUBJECT_COLORS.Physics;

                return (
                  <View style={styles.historyRow}>
                    <View style={styles.historyLeftBlock}>
                      <Text style={styles.historyDate}>{dateLabel} · {timeLabel}</Text>
                      <View style={[styles.historySubjectBadge, { backgroundColor: colorConfig.light }]}>
                        <Text style={[styles.historySubjectBadgeText, { color: colorConfig.text }]}>
                          {sub}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.historyRightBlock}>
                      <Text style={styles.historyDuration}>{durationLabel}</Text>
                      <Text style={[styles.historyStatus, { color: item.completed ? '#10B981' : '#A1A1AA' }]}>
                        {item.completed ? 'Done' : 'Stopped'}
                      </Text>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={styles.emptyText}>No recent focus logs.</Text>}
            />
          </View>
        </ScrollView>
      ) : (
        /* Analytics Tab Dashboard */
        <ScrollView contentContainerStyle={styles.analyticsScrollContainer} showsVerticalScrollIndicator={false}>
          {/* Week Selector */}
          <View style={styles.weekSelectorContainer}>
            <TouchableOpacity onPress={() => setCurrentWeekOffset(prev => prev - 1)} style={styles.navButton}>
              <ChevronLeft size={16} color="#A1A1AA" />
            </TouchableOpacity>
            <View style={styles.weekRangeWrapper}>
              <Calendar size={14} color="#71717A" style={{ marginRight: 8 }} />
              <Text style={styles.weekRangeText}>
                {startOfWeek.toLocaleDateString([], { month: 'short', day: 'numeric' })} — {endOfWeek.toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </Text>
            </View>
            <TouchableOpacity 
              onPress={() => setCurrentWeekOffset(prev => Math.min(0, prev + 1))} 
              style={[styles.navButton, currentWeekOffset === 0 && { opacity: 0.2 }]}
              disabled={currentWeekOffset === 0}
            >
              <ChevronRight size={16} color="#A1A1AA" />
            </TouchableOpacity>
          </View>

          {/* Summary Metric Strip */}
          <View style={styles.statPanel}>
            <View>
              <Text style={styles.statLabel}>Total Focus Registered</Text>
              <Text style={styles.statValue}>{formatTime(totalDurationInWeek)}</Text>
            </View>
            <Clock size={28} color="#6366F1" style={{ opacity: 0.9 }} />
          </View>

          {/* GRAPH 1: Weekly Productivity */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <BarChart2 size={16} color="#6366F1" style={{ marginRight: 8 }} />
              <Text style={styles.cardTitle}>Daily Productivity</Text>
            </View>
            <View style={styles.barGraphContainer}>
              {weeklyData.map((data, index) => {
                const percentHeight = Math.max(4, (data.totalSeconds / maxSecondsInDay) * 100);
                return (
                  <View key={index} style={styles.barCol}>
                    <Text style={styles.barValueText}>{Math.round(data.totalSeconds / 60)}m</Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { height: `${percentHeight}%` }]} />
                    </View>
                    <Text style={styles.barLabel}>{data.day}</Text>
                    <Text style={styles.barSubLabel}>{data.dateString}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* GRAPH 2: Stacked Distribution Breakdown */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Clock size={16} color="#A855F7" style={{ marginRight: 8 }} />
              <Text style={styles.cardTitle}>Subject Dynamic Mix</Text>
            </View>
            <View style={styles.barGraphContainer}>
              {weeklyData.map((data, index) => {
                const total = data.totalSeconds || 1; 
                const phyPercent = (data.Physics / total) * 100;
                const chemPercent = (data.Chemistry / total) * 100;
                const mathPercent = (data.Maths / total) * 100;
                const hasValue = data.totalSeconds > 0;

                return (
                  <View key={index} style={styles.barCol}>
                    <View style={styles.barTrack}>
                      {hasValue ? (
                        <>
                          <View style={[styles.barSegment, { height: `${phyPercent}%`, backgroundColor: SUBJECT_COLORS.Physics.primary }]} />
                          <View style={[styles.barSegment, { height: `${chemPercent}%`, backgroundColor: SUBJECT_COLORS.Chemistry.primary }]} />
                          <View style={[styles.barSegment, { height: `${mathPercent}%`, backgroundColor: SUBJECT_COLORS.Maths.primary }]} />
                        </>
                      ) : (
                        <View style={[styles.barSegment, { height: '0%', backgroundColor: 'transparent' }]} />
                      )}
                    </View>
                    <Text style={styles.barLabel}>{data.day}</Text>
                  </View>
                );
              })}
            </View>
            <View style={styles.legendContainer}>
              {SUBJECTS.map((sub) => (
                <View key={sub} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: SUBJECT_COLORS[sub].primary }]} />
                  <Text style={styles.legendText}>{sub}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* GRAPH 3: Allocation Distribution Rows */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <PieIcon size={16} color="#10B981" style={{ marginRight: 8 }} />
              <Text style={styles.cardTitle}>Focus Distribution Share</Text>
            </View>
            <View style={styles.pieContainer}>
              {totalDurationInWeek === 0 ? (
                <Text style={styles.emptyText}>No data available for the chosen time block.</Text>
              ) : (
                <View style={styles.pieLayout}>
                  <View style={styles.pieStatsBlock}>
                    {SUBJECTS.map((sub) => {
                      const share = totalDurationInWeek > 0 ? (subjectSummary[sub] / totalDurationInWeek) * 100 : 0;
                      return (
                        <View key={sub} style={styles.pieStatRow}>
                          <View style={[styles.statBorderLine, { backgroundColor: SUBJECT_COLORS[sub].primary }]} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.pieStatSubject}>{sub}</Text>
                            <Text style={styles.pieStatMeta}>{formatTime(subjectSummary[sub])}</Text>
                          </View>
                          <Text style={styles.piePercentText}>{Math.round(share)}%</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07070A',
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#121217',
    backgroundColor: '#07070A',
  },
  headerTabWrapper: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
  },
  tabButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTabButton: {
    borderBottomColor: '#6366F1',
  },
  tabText: {
    color: '#52525B',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  activeTabText: {
    color: '#F4F4F5',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  timerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 48,
  },
  dialButton: {
    width: TIMER_SIZE,
    height: TIMER_SIZE,
    borderRadius: TIMER_SIZE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0D0D12',
    position: 'relative',
    overflow: 'hidden',
  },
  progressTrack: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: TIMER_SIZE / 2,
  },
  timerText: {
    color: '#FFFFFF',
    fontSize: 58,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  subjectSelectorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 99,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  subjectSelectorText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  hintText: {
    color: '#3F3F46',
    marginTop: 12,
    fontSize: 11,
    letterSpacing: 0.2,
  },
  runningText: {
    marginTop: 18,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 48,
    gap: 16,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 99,
    backgroundColor: '#121217',
    borderWidth: 1,
    borderColor: '#1C1C24',
  },
  stopButton: {
    backgroundColor: '#0D0D12',
  },
  actionText: {
    color: '#F4F4F5',
    fontSize: 14,
    fontWeight: '600',
  },
  historyContainer: {
    marginTop: 48,
    paddingHorizontal: 24,
  },
  historyTitle: {
    color: '#4A4A52',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 16,
    letterSpacing: 1.5,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#121217',
  },
  historyLeftBlock: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 6,
  },
  historyRightBlock: {
    alignItems: 'flex-end',
    gap: 4,
  },
  historyDate: {
    color: '#D4D4D8',
    fontSize: 13,
    fontWeight: '500',
  },
  historySubjectBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  historySubjectBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  historyDuration: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  historyStatus: {
    fontSize: 11,
    fontWeight: '500',
  },
  emptyText: {
    color: '#3F3F46',
    fontSize: 13,
    marginTop: 8,
  },
  analyticsScrollContainer: {
    padding: 24,
    paddingBottom: 60,
  },
  weekSelectorContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  weekRangeWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navButton: {
    backgroundColor: '#121217',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1C1C24',
  },
  weekRangeText: {
    color: '#E4E4E7',
    fontSize: 14,
    fontWeight: '600',
  },
  statPanel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0D0D12',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#121217',
    marginBottom: 24,
  },
  statLabel: {
    color: '#71717A',
    fontSize: 12,
    fontWeight: '500',
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
    marginTop: 6,
    letterSpacing: -0.5,
  },
  card: {
    backgroundColor: '#0D0D12',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#121217',
    marginBottom: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  cardTitle: {
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  barGraphContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    height: 140,
    alignItems: 'flex-end',
  },
  barCol: {
    alignItems: 'center',
    flex: 1,
  },
  barValueText: {
    color: '#52525B',
    fontSize: 9,
    fontWeight: '600',
    marginBottom: 6,
  },
  barTrack: {
    width: 10,
    height: 90,
    backgroundColor: '#14141A',
    borderRadius: 99,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  barFill: {
    width: '100%',
    backgroundColor: '#6366F1',
    borderRadius: 99,
  },
  barSegment: {
    width: '100%',
  },
  barLabel: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 10,
  },
  barSubLabel: {
    color: '#3F3F46',
    fontSize: 8,
    marginTop: 2,
  },
  legendContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginTop: 20,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 99,
  },
  legendText: {
    color: '#71717A',
    fontSize: 11,
    fontWeight: '500',
  },
  pieContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pieLayout: {
    width: '100%',
  },
  pieStatsBlock: {
    width: '100%',
    gap: 8,
  },
  pieStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121217',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1C1C24',
  },
  statBorderLine: {
    width: 3,
    height: 20,
    borderRadius: 99,
    marginRight: 14,
  },
  pieStatSubject: {
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '600',
  },
  pieStatMeta: {
    color: '#52525B',
    fontSize: 11,
    marginTop: 2,
  },
  piePercentText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});