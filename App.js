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
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { Play, Square } from 'lucide-react-native';
import { supabase } from './lib/supabase';

const { width } = Dimensions.get('window');
const TIMER_SIZE = width * 0.75;
const CHANNEL_ID = 'default';

// Forces full popup banner alert + audio playback even if app is foreground/minimized.
// shouldShowBanner/shouldShowList are the current fields; shouldShowAlert is kept
// for older SDK compatibility.
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
  // Use ultra-short intervals for testing (e.g. 15 seconds, 30 seconds, 1 min)
  // Switch back to [5, 10, 15...] once you see the notification fire!
  const intervals = [0.25, 0.5, 1, 5, 10, 25, 50];
  const [selectedIdx, setSelectedIdx] = useState(0); // Starts at 15-second test dial

  const [secondsLeft, setSecondsLeft] = useState(intervals[selectedIdx] * 60);
  const [isActive, setIsActive] = useState(false);
  const [sessions, setSessions] = useState([]);

  const timerRef = useRef(null);
  const endTimeRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const sessionIdRef = useRef(null); // id of the currently-open Supabase row

  // ---------- Notification permission / channel setup ----------
  useEffect(() => {
    (async () => {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        Alert.alert(
          'Notifications disabled',
          'Enable notifications in system settings to get session alerts.'
        );
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

  // ---------- Supabase: fetch session history ----------
  const fetchSessions = useCallback(async () => {
    const { data, error } = await supabase
      .from('focus_sessions')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20);

    if (error) {
      console.warn('Failed to fetch sessions:', error.message);
      return;
    }
    setSessions(data ?? []);
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Mark the open session as finished (completed or not) and refresh the list.
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

  useEffect(() => {
    if (!isActive) {
      setSecondsLeft(intervals[selectedIdx] * 60);
    }
  }, [selectedIdx, isActive]);

  // Handle mathematical catch-up calculation when reopening the app
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (
        isActive &&
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
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

  // Main UI ticker interval
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

  // Detects natural completion (secondsLeft hits 0 while a session is open)
  // and closes it out as "completed" in Supabase.
  useEffect(() => {
    if (secondsLeft === 0 && sessionIdRef.current) {
      const plannedDuration = intervals[selectedIdx] * 60;
      closeSession({ completed: true, actualDurationSeconds: plannedDuration });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  const toggleTimer = async () => {
    if (isActive) {
      // Pausing - keep the session open, just stop the countdown + cancel alerts
      setIsActive(false);
      endTimeRef.current = null;
      await Notifications.cancelAllScheduledNotificationsAsync();
    } else {
      if (secondsLeft > 0) {
        setIsActive(true);

        const nowMs = Date.now();
        endTimeRef.current = nowMs + secondsLeft * 1000;

        // Open a new Supabase row only on a fresh start (not on resume-from-pause)
        if (!sessionIdRef.current) {
          const plannedDuration = intervals[selectedIdx] * 60;
          const { data, error } = await supabase
            .from('focus_sessions')
            .insert({
              started_at: new Date(nowMs).toISOString(),
              planned_duration_seconds: plannedDuration,
            })
            .select()
            .single();

          if (error) {
            console.warn('Failed to create session:', error.message);
          } else {
            sessionIdRef.current = data.id;
          }
        }

        // 1. Schedule 10-Second Warning (relative TIME_INTERVAL trigger)
        if (secondsLeft > 10) {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'Focus Session wrapping up...',
              body: '10 seconds remaining!',
              sound: true,
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: secondsLeft - 10,
              channelId: CHANNEL_ID,
            },
          });
        }

        // 2. Schedule Final Finished Alert
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Focus Session Complete! 🔔',
            body: 'Great session. Time to clear your mind and take a break.',
            sound: true,
          },
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

  const formatTime = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatSessionRow = (item) => {
    const started = new Date(item.started_at);
    const dateLabel = started.toLocaleDateString();
    const timeLabel = started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const durationLabel = item.actual_duration_seconds
      ? formatTime(item.actual_duration_seconds)
      : '--:--';
    return { dateLabel, timeLabel, durationLabel };
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0B0F" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>FOCUS</Text>
      </View>

      <View style={styles.timerContainer}>
        <TouchableOpacity
          activeOpacity={isActive ? 0.9 : 0.7}
          onPress={changeDuration}
          style={[styles.dialButton, { borderColor: isActive ? '#6366F1' : '#27272A' }]}
        >
          <View style={[styles.progressTrack, { opacity: isActive ? 0.04 : 0 }]} />

          <Text style={styles.timerText}>{formatTime(secondsLeft)}</Text>
          {!isActive && <Text style={styles.hintText}>Tap to dial duration</Text>}
          {isActive && <Text style={styles.runningText}>Target Active</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.controlsContainer}>
        <TouchableOpacity style={styles.actionButton} onPress={toggleTimer}>
          <Play
            size={24}
            color={isActive ? '#EF4444' : '#10B981'}
            fill={isActive ? '#EF4444' : '#10B981'}
          />
          <Text style={styles.actionText}>{isActive ? 'Pause' : 'Start'}</Text>
        </TouchableOpacity>

        {isActive && (
          <TouchableOpacity style={[styles.actionButton, styles.stopButton]} onPress={resetTimer}>
            <Square size={20} color="#9CA3AF" fill="#9CA3AF" />
            <Text style={[styles.actionText, { color: '#9CA3AF' }]}>Reset</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.historyContainer}>
        <Text style={styles.historyTitle}>Session History</Text>
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const { dateLabel, timeLabel, durationLabel } = formatSessionRow(item);
            return (
              <View style={styles.historyRow}>
                <Text style={styles.historyDate}>
                  {dateLabel} · {timeLabel}
                </Text>
                <Text style={styles.historyDuration}>{durationLabel}</Text>
                <Text
                  style={[
                    styles.historyStatus,
                    { color: item.completed ? '#10B981' : '#9CA3AF' },
                  ]}
                >
                  {item.completed ? 'Done' : item.stopped_at ? 'Stopped' : 'In progress'}
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.emptyText}>No sessions yet</Text>}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0B0F',
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#F4F4F5',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 4,
  },
  timerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  dialButton: {
    width: TIMER_SIZE,
    height: TIMER_SIZE,
    borderRadius: TIMER_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111114',
  },
  progressTrack: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: TIMER_SIZE / 2,
    backgroundColor: '#6366F1',
  },
  timerText: {
    color: '#F4F4F5',
    fontSize: 56,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  hintText: {
    color: '#71717A',
    marginTop: 8,
    fontSize: 13,
  },
  runningText: {
    color: '#6366F1',
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 32,
    gap: 24,
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#18181B',
  },
  stopButton: {
    backgroundColor: '#18181B',
  },
  actionText: {
    color: '#F4F4F5',
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
  },
  historyContainer: {
    flex: 1,
    marginTop: 32,
    paddingHorizontal: 20,
  },
  historyTitle: {
    color: '#F4F4F5',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 1,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1F1F23',
  },
  historyDate: {
    color: '#D4D4D8',
    fontSize: 13,
    flex: 1,
  },
  historyDuration: {
    color: '#9CA3AF',
    fontSize: 13,
    width: 60,
    textAlign: 'center',
  },
  historyStatus: {
    fontSize: 12,
    fontWeight: '600',
    width: 80,
    textAlign: 'right',
  },
  emptyText: {
    color: '#52525B',
    fontSize: 13,
    marginTop: 12,
  },
});

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: '#0B0B0F',
//     alignItems: 'center',
//     justifyContent: 'space-between',
//     paddingVertical: 60,
//   },
//   header: {
//     marginTop: Platform.OS === 'ios' ? 20 : 40,
//     width: '100%',
//     alignItems: 'center',
//   },
//   headerTitle: {
//     fontSize: 18,
//     fontWeight: '700',
//     color: '#F4F4F5',
//     letterSpacing: 4,
//   },
//   timerContainer: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   dialButton: {
//     width: TIMER_SIZE,
//     height: TIMER_SIZE,
//     borderRadius: TIMER_SIZE / 2,
//     borderWidth: 4,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: '#121218',
//     elevation: 4,
//     shadowColor: '#000',
//     shadowOffset: { width: 0, height: 4 },
//     shadowOpacity: 0.3,
//     shadowRadius: 8,
//     position: 'relative',
//     overflow: 'hidden',
//   },
//   progressTrack: {
//     ...StyleSheet.absoluteFillObject,
//     backgroundColor: '#6366F1',
//   },
//   timerText: {
//     fontSize: 54,
//     fontWeight: '300',
//     color: '#FFFFFF',
//     fontVariant: ['tabular-nums'],
//     letterSpacing: 1,
//   },
//   hintText: {
//     fontSize: 12,
//     color: '#71717A',
//     marginTop: 8,
//     letterSpacing: 0.5,
//   },
//   runningText: {
//     fontSize: 12,
//     color: '#6366F1',
//     marginTop: 8,
//     fontWeight: '600',
//     letterSpacing: 1,
//   },
//   controlsContainer: {
//     flexDirection: 'row',
//     gap: 20,
//     marginBottom: 20,
//   },
//   actionButton: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: '#18181B',
//     paddingHorizontal: 28,
//     paddingVertical: 14,
//     borderRadius: 30,
//     gap: 8,
//     borderWidth: 1,
//     borderColor: '#27272A',
//   },
//   stopButton: {
//     borderColor: '#27272A',
//   },
//   actionText: {
//     color: '#FFFFFF',
//     fontSize: 16,
//     fontWeight: '600',
//   },
// });